import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import {
  customerInvoiceLines,
  customerInvoices,
  customerPaymentAllocations,
  customerPayments,
  salesCreditNotes,
  salesDeliveryLines,
} from "@/db/schema";
import type { CreateCustomerInvoiceInput, ListSalesQuery } from "@/modules/sales/schemas";
import { assertActiveCurrency, assertCan, requireActiveCustomer } from "@/modules/sales/_refs";
import { requirePostedDelivery } from "@/modules/sales/delivery-service";
import { resolveArAccountIds } from "@/modules/sales/ar-account-config";
import { resolveRateToBase } from "@/modules/organization/currency-service";
import { createTaxTransaction } from "@/modules/accounting/tax-transaction-service";
import { createSystemDraft, postJournal, reverseJournal } from "@/modules/accounting/journal-service";
import { cmp, div, mul, round, sub, sum, toDb } from "@/lib/money";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { businessRule, notFound, validationFailed } from "@/server/errors";
import { nextDocumentNumber } from "@/server/numbering";
import type { AuthContext } from "@/server/authz";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Tx | typeof db;

/** sourceType jurnal AR untuk faktur penjualan (Dr AR / Cr Revenue + Cr TaxPayable). */
const SOURCE_INVOICE = "customer_invoice";
const QTY_DP = 3;
const TOTAL_DP = 2;

const invColumns = {
  id: customerInvoices.id,
  docNo: customerInvoices.docNo,
  status: customerInvoices.status,
  deliveryId: customerInvoices.deliveryId,
  customerId: customerInvoices.customerId,
  branchId: customerInvoices.branchId,
  invoiceDate: customerInvoices.invoiceDate,
  dueDate: customerInvoices.dueDate,
  currency: customerInvoices.currency,
  exchangeRate: customerInvoices.exchangeRate,
  subtotalForeign: customerInvoices.subtotalForeign,
  taxForeign: customerInvoices.taxForeign,
  totalForeign: customerInvoices.totalForeign,
  subtotalBase: customerInvoices.subtotalBase,
  taxBase: customerInvoices.taxBase,
  totalBase: customerInvoices.totalBase,
  amountPaid: customerInvoices.amountPaid,
  journalEntryId: customerInvoices.journalEntryId,
  taxTransactionId: customerInvoices.taxTransactionId,
  notes: customerInvoices.notes,
  postedAt: customerInvoices.postedAt,
  cancelledAt: customerInvoices.cancelledAt,
  reversedAt: customerInvoices.reversedAt,
  reason: customerInvoices.reason,
  createdAt: customerInvoices.createdAt,
  updatedAt: customerInvoices.updatedAt,
};

async function loadLines(reader: Reader, invoiceId: string) {
  return reader
    .select({
      id: customerInvoiceLines.id,
      invoiceId: customerInvoiceLines.invoiceId,
      lineNo: customerInvoiceLines.lineNo,
      deliveryLineId: customerInvoiceLines.deliveryLineId,
      productId: customerInvoiceLines.productId,
      description: customerInvoiceLines.description,
      quantity: customerInvoiceLines.quantity,
      unitPrice: customerInvoiceLines.unitPrice,
      amountForeign: customerInvoiceLines.amountForeign,
      amountBase: customerInvoiceLines.amountBase,
      taxAmount: customerInvoiceLines.taxAmount,
    })
    .from(customerInvoiceLines)
    .where(eq(customerInvoiceLines.invoiceId, invoiceId))
    .orderBy(asc(customerInvoiceLines.lineNo));
}

async function requireInvoice(reader: Reader, id: string) {
  const [header] = await reader.select(invColumns).from(customerInvoices).where(eq(customerInvoices.id, id)).limit(1);
  if (!header) throw notFound("Faktur penjualan tidak ditemukan.");
  const lines = await loadLines(reader, id);
  return { ...header, lines };
}

async function lockInvoice(tx: Tx, id: string) {
  const [row] = await tx.select(invColumns).from(customerInvoices).where(eq(customerInvoices.id, id)).for("update").limit(1);
  if (!row) throw notFound("Faktur penjualan tidak ditemukan.");
  return row;
}

/* ----------------------------- Baca ------------------------------ */

export async function listInvoices(actor: AuthContext, query: ListSalesQuery = {}, externalTx?: Tx) {
  assertCan(actor, "sales.invoices.read");
  const reader = externalTx ?? db;
  const conditions: (SQL | undefined)[] = [
    query.status === undefined ? undefined : eq(customerInvoices.status, query.status as "draft"),
    query.customerId === undefined ? undefined : eq(customerInvoices.customerId, query.customerId),
    query.branchId === undefined ? undefined : eq(customerInvoices.branchId, query.branchId),
  ];
  return reader.select(invColumns).from(customerInvoices).where(and(...conditions)).orderBy(desc(customerInvoices.invoiceDate));
}

export async function getInvoice(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "sales.invoices.read");
  return requireInvoice(externalTx ?? db, id);
}

/* ----------------------------- Tulis: draf ----------------------------- */

/**
 * Buat faktur draf dari pengiriman posted. Setiap baris merujuk delivery line
 * dan jumlah menagih tidak boleh melebihi jumlah kirim dikurangi yang sudah
 * ditagih faktur aktif lain. PPN diselesaikan saat posting.
 */
export async function createInvoice(actor: AuthContext, input: CreateCustomerInvoiceInput, externalTx?: Tx) {
  assertCan(actor, "sales.invoices.manage");
  const run = async (tx: Tx) => {
    const delivery = await requirePostedDelivery(tx, input.deliveryId);
    if (delivery.branchId !== input.branchId) throw validationFailed([{ path: "branchId", message: "Cabang faktur harus sama dengan cabang pengiriman." }]);
    if (input.dueDate < input.invoiceDate) throw validationFailed([{ path: "dueDate", message: "Jatuh tempo tidak boleh sebelum tanggal faktur." }]);

    const dlvLineIds = [...new Set(input.lines.map((l) => l.deliveryLineId))];
    const dlvLines = await tx
      .select({
        id: salesDeliveryLines.id,
        deliveryId: salesDeliveryLines.deliveryId,
        productId: salesDeliveryLines.productId,
        quantity: salesDeliveryLines.quantity,
      })
      .from(salesDeliveryLines)
      .where(inArray(salesDeliveryLines.id, dlvLineIds));
    const dlvById = new Map(dlvLines.map((l) => [l.id, l]));

    const billedAlready = await getBilledQtyByDeliveryLine(tx, dlvLineIds);

    const customer = await requireActiveCustomer(tx, delivery.customerId);
    const currency = input.currency ?? customer.currency;
    await assertActiveCurrency(tx, currency);

    const foreign: string[] = [];
    const requestedByDlvLine = new Map<string, string>();
    for (const [index, line] of input.lines.entries()) {
      const path = `lines.${index}`;
      const dlv = dlvById.get(line.deliveryLineId);
      if (!dlv || dlv.deliveryId !== input.deliveryId) throw validationFailed([{ path: `${path}.deliveryLineId`, message: "Baris pengiriman tidak ditemukan atau bukan milik pengiriman ini." }]);
      if (line.productId !== dlv.productId) throw validationFailed([{ path: `${path}.productId`, message: "Produk tidak cocok dengan baris pengiriman." }]);

      const alreadyBilled = billedAlready.get(line.deliveryLineId) ?? "0.000";
      const newAcc = toDb(sum([requestedByDlvLine.get(line.deliveryLineId) ?? "0.000", line.quantity]), QTY_DP);
      const totalBilled = toDb(sum([alreadyBilled, newAcc]), QTY_DP);
      if (cmp(totalBilled, dlv.quantity) > 0) {
        throw businessRule(`Total tagihan (${totalBilled}) melebihi jumlah kirim (${dlv.quantity}) pada baris ${index + 1}.`);
      }
      requestedByDlvLine.set(line.deliveryLineId, newAcc);
      foreign.push(toDb(mul(line.quantity, line.unitPrice), TOTAL_DP));
    }

    const subtotalForeign = toDb(sum(foreign), TOTAL_DP);

    const [header] = await tx.insert(customerInvoices).values({
      status: "draft",
      deliveryId: input.deliveryId,
      customerId: delivery.customerId,
      branchId: delivery.branchId,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate,
      currency,
      subtotalForeign,
      taxForeign: "0.00",
      totalForeign: subtotalForeign,
      subtotalBase: "0.00",
      taxBase: "0.00",
      totalBase: "0.00",
      amountPaid: "0.00",
      notes: input.notes ?? null,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    }).returning({ id: customerInvoices.id });

    await tx.insert(customerInvoiceLines).values(
      input.lines.map((line, index) => ({
        invoiceId: header!.id,
        lineNo: index + 1,
        deliveryLineId: line.deliveryLineId,
        productId: line.productId ?? dlvById.get(line.deliveryLineId)?.productId ?? null,
        description: line.description ?? null,
        quantity: toDb(line.quantity, QTY_DP),
        unitPrice: toDb(line.unitPrice, 4),
        amountForeign: foreign[index] ?? "0.00",
        amountBase: "0.00",
        taxAmount: "0.00",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })),
    );

    await audit.log({ action: "sales.invoice.create", entityType: "customer_invoice", entityId: header!.id, actorId: actor.userId, after: { deliveryId: input.deliveryId, subtotalForeign } }, tx);
    return requireInvoice(tx, header!.id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

/* -------------------------- Transisi: post ------------------------- */

/**
 * draft -> posted. Snapshot kurs, hitung basis per baris + subtotal, hitung PPN
 * dari tarif pajak master (bila taxId diisi) via transaksi pajak, lalu terbitkan
 * jurnal Dr AR / Cr Revenue + Cr TaxPayable. Isi docNo, exchangeRate, totals.
 */
export async function postInvoice(actor: AuthContext, id: string, taxId: string | null, externalTx?: Tx) {
  assertCan(actor, "sales.invoices.post");
  const run = async (tx: Tx) => {
    const current = await lockInvoice(tx, id);
    if (current.status !== "draft") throw businessRule("Hanya faktur berstatus draft yang dapat diposting.");

    const lines = await loadLines(tx, id);
    if (lines.length === 0) throw businessRule("Faktur tidak memiliki baris untuk diposting.");

    const { rate } = await resolveRateToBase(tx, current.currency, current.invoiceDate);

    let subtotalBase = "0.00";
    for (const line of lines) {
      const lineBase = toDb(round(mul(line.amountForeign, rate), TOTAL_DP), TOTAL_DP);
      subtotalBase = toDb(sum([subtotalBase, lineBase]), TOTAL_DP);
      await tx.update(customerInvoiceLines).set({ amountBase: lineBase, updatedBy: actor.userId, updatedAt: new Date() }).where(eq(customerInvoiceLines.id, line.id));
    }
    const subtotalForeign = current.subtotalForeign;

    let taxBase = "0.00";
    let taxForeign = "0.00";
    let taxTransactionId: string | null = null;
    if (taxId) {
      const txn = await createTaxTransaction(
        actor,
        { taxId, transactionDate: current.invoiceDate, direction: "collect", baseAmount: subtotalBase, branchId: current.branchId, notes: `PPN output faktur ${current.id}` },
        tx,
      );
      taxBase = toDb(txn.taxAmount, TOTAL_DP);
      taxForeign = toDb(round(mul(subtotalForeign, div(txn.rate, 100)), TOTAL_DP), TOTAL_DP);
      taxTransactionId = txn.id;
      await spreadTaxToLines(tx, actor, id, taxBase);
    }

    const totalBase = toDb(sum([subtotalBase, taxBase]), TOTAL_DP);
    const totalForeign = toDb(sum([subtotalForeign, taxForeign]), TOTAL_DP);

    const { arAccountId, revenueAccountId, taxPayableAccountId } = await resolveArAccountIds(tx);
    const journalLines = [
      { accountId: arAccountId, side: "debit" as const, amount: totalBase },
      { accountId: revenueAccountId, side: "credit" as const, amount: subtotalBase },
    ];
    if (cmp(taxBase, "0") > 0) journalLines.push({ accountId: taxPayableAccountId, side: "credit" as const, amount: taxBase });

    const draft = await createSystemDraft(tx, actor, {
      entryDate: current.invoiceDate,
      description: `Faktur penjualan ${current.docNo ?? current.id}`,
      lines: journalLines,
      sourceType: SOURCE_INVOICE,
      sourceId: current.id,
      sourceEvent: "post",
    });
    const posted = await postJournal(actor, draft.id, tx);

    const docNo = await nextDocumentNumber(tx, "customer_invoice", { date: current.invoiceDate, branchId: current.branchId });

    await tx.update(customerInvoices).set({
      status: "posted",
      docNo,
      exchangeRate: rate,
      subtotalBase,
      taxBase,
      taxForeign,
      totalBase,
      totalForeign,
      journalEntryId: posted.id,
      taxTransactionId,
      postedAt: new Date(),
      updatedBy: actor.userId,
      updatedAt: new Date(),
    }).where(eq(customerInvoices.id, id));

    await audit.log({ action: "sales.invoice.post", entityType: "customer_invoice", entityId: id, actorId: actor.userId, after: { status: "posted", docNo, totalBase, taxBase, journalEntryId: posted.id } }, tx);
    return requireInvoice(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

/* -------------------------- Transisi: cancel ----------------------- */

export async function cancelInvoice(actor: AuthContext, id: string, reason: string, externalTx?: Tx) {
  assertCan(actor, "sales.invoices.manage");
  const run = async (tx: Tx) => {
    const current = await lockInvoice(tx, id);
    if (current.status !== "draft") throw businessRule("Hanya faktur berstatus draft yang dapat dibatalkan. Gunakan reversal untuk faktur posted.");
    await tx.update(customerInvoices).set({ status: "cancelled", reason, cancelledAt: new Date(), updatedBy: actor.userId, updatedAt: new Date() }).where(eq(customerInvoices.id, id));
    await audit.log({ action: "sales.invoice.cancel", entityType: "customer_invoice", entityId: id, actorId: actor.userId, after: { status: "cancelled", reason } }, tx);
    return requireInvoice(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

/* -------------------------- Transisi: reverse ---------------------- */

/** posted -> reversed: balik jurnal AR. Tolak bila sudah ada pembayaran terposting. */
export async function reverseInvoice(actor: AuthContext, id: string, reason: string, externalTx?: Tx) {
  assertCan(actor, "sales.invoices.post");
  const run = async (tx: Tx) => {
    const current = await lockInvoice(tx, id);
    if (current.status !== "posted") throw businessRule("Hanya faktur berstatus posted yang dapat dibalik.");
    if (!current.journalEntryId) throw businessRule("Faktur posted tanpa jurnal terkait; tidak dapat dibalik.");

    const [alloc] = await tx
      .select({ total: sql<string>`coalesce(sum(${customerPaymentAllocations.amountBase}), '0')` })
      .from(customerPaymentAllocations)
      .innerJoin(customerPayments, eq(customerPayments.id, customerPaymentAllocations.paymentId))
      .where(and(eq(customerPaymentAllocations.invoiceId, id), eq(customerPayments.status, "posted")));
    if (cmp(alloc?.total ?? "0", "0") > 0) throw businessRule("Faktur sudah memiliki pembayaran terposting; reverse pembayaran lebih dulu.");

    await reverseJournal(actor, current.journalEntryId, { reason }, tx);

    await tx.update(customerInvoices).set({ status: "reversed", reason, reversedAt: new Date(), updatedBy: actor.userId, updatedAt: new Date() }).where(eq(customerInvoices.id, id));
    await audit.log({ action: "sales.invoice.reverse", entityType: "customer_invoice", entityId: id, actorId: actor.userId, after: { status: "reversed", reason } }, tx);
    return requireInvoice(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

/* --------------------- Pembaca untuk payment/CN --------------------- */

/** Total qty sudah ditagih per delivery line pada faktur aktif (draft/posted). */
async function getBilledQtyByDeliveryLine(tx: Tx, deliveryLineIds: string[]): Promise<Map<string, string>> {
  if (deliveryLineIds.length === 0) return new Map();
  const rows = await tx
    .select({
      deliveryLineId: customerInvoiceLines.deliveryLineId,
      qty: sql<string>`coalesce(sum(${customerInvoiceLines.quantity}), 0)::numeric(18,3)`,
    })
    .from(customerInvoiceLines)
    .innerJoin(customerInvoices, eq(customerInvoices.id, customerInvoiceLines.invoiceId))
    .where(and(inArray(customerInvoiceLines.deliveryLineId, [...new Set(deliveryLineIds)]), sql`${customerInvoices.status} in ('draft', 'posted')`))
    .groupBy(customerInvoiceLines.deliveryLineId);
  return new Map(rows.map((r) => [r.deliveryLineId, toDb(r.qty, QTY_DP)]));
}

/** Sebar PPN (basis) ke baris proporsional amountBase; baris terakhir menampung sisa pembulatan. */
async function spreadTaxToLines(tx: Tx, actor: AuthContext, invoiceId: string, taxBase: string) {
  const lines = await loadLines(tx, invoiceId);
  const subtotalBase = toDb(sum(lines.map((l) => l.amountBase)), TOTAL_DP);
  if (cmp(subtotalBase, "0") <= 0) return;
  let allocated = "0.00";
  for (const [index, line] of lines.entries()) {
    const share = index === lines.length - 1
      ? toDb(sub(taxBase, allocated), TOTAL_DP)
      : toDb(round(mul(taxBase, div(line.amountBase, subtotalBase)), TOTAL_DP), TOTAL_DP);
    allocated = toDb(sum([allocated, share]), TOTAL_DP);
    await tx.update(customerInvoiceLines).set({ taxAmount: share, updatedBy: actor.userId, updatedAt: new Date() }).where(eq(customerInvoiceLines.id, line.id));
  }
}

/** Invoice posted + sisa (basis) per pelanggan, urut jatuh tempo — dipakai alokasi pembayaran. */
export type OpenCustomerInvoice = {
  id: string;
  docNo: string | null;
  currency: string;
  dueDate: string;
  exchangeRate: string;
  remainingBase: string;
};

export async function loadOpenInvoicesForCustomer(tx: Tx, customerId: string): Promise<OpenCustomerInvoice[]> {
  const invoices = await tx
    .select({
      id: customerInvoices.id,
      docNo: customerInvoices.docNo,
      currency: customerInvoices.currency,
      dueDate: customerInvoices.dueDate,
      exchangeRate: customerInvoices.exchangeRate,
      totalBase: customerInvoices.totalBase,
    })
    .from(customerInvoices)
    .where(and(eq(customerInvoices.customerId, customerId), eq(customerInvoices.status, "posted")))
    .orderBy(asc(customerInvoices.dueDate), asc(customerInvoices.id));
  if (invoices.length === 0) return [];

  const ids = invoices.map((i) => i.id);
  const paidRows = await tx
    .select({ invoiceId: customerPaymentAllocations.invoiceId, total: sql<string>`coalesce(sum(${customerPaymentAllocations.amountBase}), '0')` })
    .from(customerPaymentAllocations)
    .innerJoin(customerPayments, eq(customerPayments.id, customerPaymentAllocations.paymentId))
    .where(and(inArray(customerPaymentAllocations.invoiceId, ids), eq(customerPayments.status, "posted")))
    .groupBy(customerPaymentAllocations.invoiceId);
  const creditRows = await tx
    .select({ invoiceId: salesCreditNotes.invoiceId, total: sql<string>`coalesce(sum(${salesCreditNotes.totalBase}), '0')` })
    .from(salesCreditNotes)
    .where(and(inArray(salesCreditNotes.invoiceId, ids), eq(salesCreditNotes.status, "posted")))
    .groupBy(salesCreditNotes.invoiceId);

  const paid = new Map(paidRows.map((r) => [r.invoiceId, toDb(r.total, TOTAL_DP)]));
  const credited = new Map(creditRows.map((r) => [r.invoiceId, toDb(r.total, TOTAL_DP)]));

  const result: OpenCustomerInvoice[] = [];
  for (const inv of invoices) {
    const remainingBase = toDb(sub(inv.totalBase, sum([paid.get(inv.id) ?? "0.00", credited.get(inv.id) ?? "0.00"])), TOTAL_DP);
    if (cmp(remainingBase, "0") > 0) {
      result.push({ id: inv.id, docNo: inv.docNo, currency: inv.currency, dueDate: inv.dueDate, exchangeRate: inv.exchangeRate ?? "1.000000", remainingBase });
    }
  }
  return result;
}

/** Muat header faktur posted untuk payment/credit-note (fail-closed). */
export async function requirePostedInvoice(tx: Tx, id: string) {
  const inv = await requireInvoice(tx, id);
  if (inv.status !== "posted") throw businessRule("Hanya faktur berstatus posted yang dapat dibayar/dikrediti.");
  return inv;
}
