import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";

import { bankAccounts, customerPaymentAllocations, customerPayments, customerInvoices } from "@/db/schema";
import type { CreateCustomerPaymentInput, ListSalesQuery } from "@/modules/sales/schemas";
import { assertActiveBranch, assertActiveCurrency, assertCan, requireActiveCustomer } from "@/modules/sales/_refs";
import { loadOpenInvoicesForCustomer } from "@/modules/sales/invoice-service";
import { resolveArAccountIds } from "@/modules/sales/ar-account-config";
import { resolveRateToBase } from "@/modules/organization/currency-service";
import { createSystemDraft, postJournal, reverseJournal } from "@/modules/accounting/journal-service";
import { cmp, div, mul, round, sub, toDb } from "@/lib/money";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { businessRule, notFound, validationFailed } from "@/server/errors";
import { nextDocumentNumber } from "@/server/numbering";
import type { AuthContext } from "@/server/authz";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Tx | typeof db;

/** sourceType jurnal AR untuk pembayaran customer (Dr Bank / Cr AR — kas masuk, piutang turun). */
const SOURCE_PAYMENT = "customer_payment";
const TOTAL_DP = 2;

const payColumns = {
  id: customerPayments.id,
  docNo: customerPayments.docNo,
  status: customerPayments.status,
  customerId: customerPayments.customerId,
  branchId: customerPayments.branchId,
  paymentDate: customerPayments.paymentDate,
  currency: customerPayments.currency,
  exchangeRate: customerPayments.exchangeRate,
  amountForeign: customerPayments.amountForeign,
  amountBase: customerPayments.amountBase,
  bankAccountId: customerPayments.bankAccountId,
  journalEntryId: customerPayments.journalEntryId,
  memo: customerPayments.memo,
  postedAt: customerPayments.postedAt,
  cancelledAt: customerPayments.cancelledAt,
  reversedAt: customerPayments.reversedAt,
  reason: customerPayments.reason,
  createdAt: customerPayments.createdAt,
  updatedAt: customerPayments.updatedAt,
};

async function loadAllocations(reader: Reader, paymentId: string) {
  return reader
    .select({
      id: customerPaymentAllocations.id,
      invoiceId: customerPaymentAllocations.invoiceId,
      amountBase: customerPaymentAllocations.amountBase,
      amountForeign: customerPaymentAllocations.amountForeign,
    })
    .from(customerPaymentAllocations)
    .where(eq(customerPaymentAllocations.paymentId, paymentId))
    .orderBy(asc(customerPaymentAllocations.invoiceId));
}

async function requirePayment(reader: Reader, id: string) {
  const [header] = await reader.select(payColumns).from(customerPayments).where(eq(customerPayments.id, id)).limit(1);
  if (!header) throw notFound("Pembayaran customer tidak ditemukan.");
  const allocations = await loadAllocations(reader, id);
  return { ...header, allocations };
}

async function lockPayment(tx: Tx, id: string) {
  const [row] = await tx.select(payColumns).from(customerPayments).where(eq(customerPayments.id, id)).for("update").limit(1);
  if (!row) throw notFound("Pembayaran customer tidak ditemukan.");
  return row;
}

/** Rekening kas/bank aktif; mengembalikan id akun GL penampungnya. */
async function requireActiveBankAccount(tx: Tx, id: string, path: string): Promise<string> {
  const [account] = await tx
    .select({ id: bankAccounts.id, code: bankAccounts.code, isActive: bankAccounts.isActive, accountId: bankAccounts.accountId })
    .from(bankAccounts)
    .where(eq(bankAccounts.id, id))
    .limit(1);
  if (!account) throw validationFailed([{ path, message: "Rekening kas/bank tidak ditemukan." }]);
  if (!account.isActive) throw businessRule(`Rekening ${account.code} tidak aktif.`);
  return account.accountId;
}

/* ----------------------------- Baca ------------------------------ */

export async function listPayments(actor: AuthContext, query: ListSalesQuery = {}, externalTx?: Tx) {
  assertCan(actor, "sales.payments.read");
  const reader = externalTx ?? db;
  const conditions: (SQL | undefined)[] = [
    query.status === undefined ? undefined : eq(customerPayments.status, query.status as "draft"),
    query.customerId === undefined ? undefined : eq(customerPayments.customerId, query.customerId),
    query.branchId === undefined ? undefined : eq(customerPayments.branchId, query.branchId),
  ];
  return reader.select(payColumns).from(customerPayments).where(and(...conditions)).orderBy(desc(customerPayments.paymentDate));
}

export async function getPayment(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "sales.payments.read");
  return requirePayment(externalTx ?? db, id);
}

/* ----------------------------- Tulis: draf ----------------------------- */

/** Buat pembayaran customer draf. Kurs/amountBase + alokasi FIFO diselesaikan saat posting. */
export async function createPayment(actor: AuthContext, input: CreateCustomerPaymentInput, externalTx?: Tx) {
  assertCan(actor, "sales.payments.manage");
  const run = async (tx: Tx) => {
    if (cmp(input.amountForeign, "0") <= 0) throw validationFailed([{ path: "amountForeign", message: "Jumlah pembayaran harus lebih dari nol." }]);

    const customer = await requireActiveCustomer(tx, input.customerId);
    await assertActiveBranch(tx, input.branchId);
    await requireActiveBankAccount(tx, input.bankAccountId, "bankAccountId");

    const currency = input.currency ?? customer.currency;
    await assertActiveCurrency(tx, currency);

    const [payment] = await tx.insert(customerPayments).values({
      status: "draft",
      customerId: input.customerId,
      branchId: input.branchId,
      paymentDate: input.paymentDate,
      currency,
      amountForeign: toDb(input.amountForeign, TOTAL_DP),
      amountBase: "0.00",
      bankAccountId: input.bankAccountId,
      memo: input.memo ?? null,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    }).returning({ id: customerPayments.id });

    await audit.log({ action: "sales.payment.create", entityType: "customer_payment", entityId: payment!.id, actorId: actor.userId, after: { customerId: input.customerId, currency, amountForeign: toDb(input.amountForeign, TOTAL_DP) } }, tx);
    return requirePayment(tx, payment!.id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

/* -------------------------- Transisi: post ------------------------- */

/**
 * draft -> posted. Snapshot kurs paymentDate -> amountBase, alokasi FIFO ke
 * invoice terbuka (urut jatuh tempo), terbitkan jurnal Dr AR / Cr Bank dalam
 * mata uang dasar, naikkan amountPaid tiap invoice yang dialokasi. Pembayaran
 * melebihi total piutang terbuka ditolak (no overpayment).
 */
export async function postPayment(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "sales.payments.post");
  const run = async (tx: Tx) => {
    const current = await lockPayment(tx, id);
    if (current.status !== "draft") throw businessRule("Hanya pembayaran berstatus draft yang dapat diposting.");

    await requireActiveCustomer(tx, current.customerId);
    const bankGlAccountId = await requireActiveBankAccount(tx, current.bankAccountId, "bankAccountId");

    const { rate } = await resolveRateToBase(tx, current.currency, current.paymentDate);
    const amountBase = toDb(round(mul(current.amountForeign, rate), TOTAL_DP), TOTAL_DP);
    if (cmp(amountBase, "0") <= 0) throw businessRule("Nilai basis pembayaran bernilai nol; periksa kurs dan jumlah.");

    // Alokasi FIFO ke invoice terbuka (sisa > 0), urut jatuh tempo.
    const openInvoices = await loadOpenInvoicesForCustomer(tx, current.customerId);
    let left = amountBase;
    const allocations: { invoiceId: string; amountBase: string; amountForeign: string }[] = [];
    for (const inv of openInvoices) {
      if (cmp(left, "0") <= 0) break;
      const applied = cmp(inv.remainingBase, left) <= 0 ? inv.remainingBase : left;
      allocations.push({
        invoiceId: inv.id,
        amountBase: toDb(applied, TOTAL_DP),
        amountForeign: toDb(div(applied, inv.exchangeRate), TOTAL_DP),
      });
      left = toDb(sub(left, applied), TOTAL_DP);
    }
    if (cmp(left, "0") > 0) throw businessRule(`Jumlah pembayaran (${amountBase}) melebihi total piutang terbuka customer ini.`);
    if (allocations.length === 0) throw businessRule("Tidak ada invoice terbuka untuk dialokasikan.");

    const { arAccountId } = await resolveArAccountIds(tx);
    const draft = await createSystemDraft(tx, actor, {
      entryDate: current.paymentDate,
      description: `Pembayaran customer ${current.memo ?? current.id}`,
      lines: [
        { accountId: bankGlAccountId, side: "debit", amount: amountBase },
        { accountId: arAccountId, side: "credit", amount: amountBase },
      ],
      sourceType: SOURCE_PAYMENT,
      sourceId: current.id,
      sourceEvent: "post",
    });
    const posted = await postJournal(actor, draft.id, tx);

    await tx.insert(customerPaymentAllocations).values(
      allocations.map((a) => ({
        paymentId: current.id,
        invoiceId: a.invoiceId,
        amountBase: a.amountBase,
        amountForeign: a.amountForeign,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })),
    );

    // Naikkan amountPaid tiap invoice yang dialokasi (akurat lewat aritmetika numeric DB).
    for (const a of allocations) {
      await tx.update(customerInvoices).set({
        amountPaid: sql`${customerInvoices.amountPaid} + ${a.amountBase}`,
        updatedAt: new Date(),
        updatedBy: actor.userId,
      }).where(eq(customerInvoices.id, a.invoiceId));
    }

    const docNo = await nextDocumentNumber(tx, "customer_payment", { date: current.paymentDate });

    await tx.update(customerPayments).set({
      status: "posted", docNo, exchangeRate: rate, amountBase, journalEntryId: posted.id, postedAt: new Date(), updatedBy: actor.userId, updatedAt: new Date(),
    }).where(eq(customerPayments.id, id));

    await audit.log({ action: "sales.payment.post", entityType: "customer_payment", entityId: id, actorId: actor.userId, after: { status: "posted", docNo, amountBase, journalEntryId: posted.id, allocationCount: allocations.length } }, tx);
    return requirePayment(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

/* -------------------------- Transisi: cancel ----------------------- */

export async function cancelPayment(actor: AuthContext, id: string, reason: string, externalTx?: Tx) {
  assertCan(actor, "sales.payments.manage");
  const run = async (tx: Tx) => {
    const current = await lockPayment(tx, id);
    if (current.status !== "draft") throw businessRule("Hanya pembayaran berstatus draft yang dapat dibatalkan. Gunakan reversal untuk pembayaran posted.");
    await tx.update(customerPayments).set({ status: "cancelled", reason, cancelledAt: new Date(), updatedBy: actor.userId, updatedAt: new Date() }).where(eq(customerPayments.id, id));
    await audit.log({ action: "sales.payment.cancel", entityType: "customer_payment", entityId: id, actorId: actor.userId, after: { status: "cancelled", reason } }, tx);
    return requirePayment(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

/* -------------------------- Transisi: reverse ---------------------- */

/** posted -> reversed: balik jurnal + hapus alokasi + kurangi amountPaid. */
export async function reversePayment(actor: AuthContext, id: string, reason: string, externalTx?: Tx) {
  assertCan(actor, "sales.payments.post");
  const run = async (tx: Tx) => {
    const current = await lockPayment(tx, id);
    if (current.status !== "posted") throw businessRule("Hanya pembayaran berstatus posted yang dapat dibalik.");
    if (!current.journalEntryId) throw businessRule("Pembayaran posted tanpa jurnal terkait; tidak dapat dibalik.");

    const allocations = await loadAllocations(tx, id);
    if (current.journalEntryId) await reverseJournal(actor, current.journalEntryId, { reason }, tx);

    for (const a of allocations) {
      await tx.update(customerInvoices).set({
        amountPaid: sql`GREATEST(${customerInvoices.amountPaid} - ${a.amountBase}, 0)`,
        updatedAt: new Date(),
        updatedBy: actor.userId,
      }).where(eq(customerInvoices.id, a.invoiceId));
    }
    await tx.delete(customerPaymentAllocations).where(eq(customerPaymentAllocations.paymentId, id));

    await tx.update(customerPayments).set({ status: "reversed", reason, reversedAt: new Date(), updatedBy: actor.userId, updatedAt: new Date() }).where(eq(customerPayments.id, id));
    await audit.log({ action: "sales.payment.reverse", entityType: "customer_payment", entityId: id, actorId: actor.userId, after: { status: "reversed", reason } }, tx);
    return requirePayment(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}
