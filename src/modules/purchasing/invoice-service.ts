import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import { apPaymentAllocations, apPayments, supplierInvoiceLines, supplierInvoices } from "@/db/schema";
import {
  createSupplierInvoiceSchema,
  listSupplierInvoicesQuerySchema,
  updateSupplierInvoiceSchema,
  type CreateSupplierInvoiceInput,
  type ListSupplierInvoicesQuery,
  type UpdateSupplierInvoiceInput,
} from "@/modules/purchasing/schemas";
import { assertCan } from "@/modules/purchasing/_refs";
import { requirePostedPurchaseOrder } from "@/modules/purchasing/po-service";
import { resolveApAccountIds } from "@/modules/purchasing/ap-account-config";
import { resolveRateToBase } from "@/modules/organization/currency-service";
import { cmp, dec, div, mul, round, sum, toDb } from "@/lib/money";
import { createSystemDraft, postJournal, reverseJournal } from "@/modules/accounting/journal-service";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { businessRule, conflict, notFound, validationFailed } from "@/server/errors";
import { nextDocumentNumber } from "@/server/numbering";
import type { AuthContext } from "@/server/authz";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Tx | typeof db;

const SOURCE_INVOICE = "supplier_invoice";
const QTY_DP = 3;
const TOTAL_DP = 2;
/** Toleransi pembulatan selisih nilai per baris pada three-way match (±0.01). */
const PRICE_TOLERANCE = "0.01";

const invoiceColumns = {
  id: supplierInvoices.id,
  docNo: supplierInvoices.docNo,
  status: supplierInvoices.status,
  supplierId: supplierInvoices.supplierId,
  poId: supplierInvoices.poId,
  branchId: supplierInvoices.branchId,
  invoiceDate: supplierInvoices.invoiceDate,
  dueDate: supplierInvoices.dueDate,
  currency: supplierInvoices.currency,
  exchangeRate: supplierInvoices.exchangeRate,
  totalForeign: supplierInvoices.totalForeign,
  totalBase: supplierInvoices.totalBase,
  journalEntryId: supplierInvoices.journalEntryId,
  notes: supplierInvoices.notes,
  postedAt: supplierInvoices.postedAt,
  cancelledAt: supplierInvoices.cancelledAt,
  reversedAt: supplierInvoices.reversedAt,
  reason: supplierInvoices.reason,
  createdAt: supplierInvoices.createdAt,
  updatedAt: supplierInvoices.updatedAt,
};

async function loadLines(reader: Reader, invoiceId: string) {
  return reader
    .select({
      id: supplierInvoiceLines.id,
      invoiceId: supplierInvoiceLines.invoiceId,
      lineNo: supplierInvoiceLines.lineNo,
      poLineId: supplierInvoiceLines.poLineId,
      productId: supplierInvoiceLines.productId,
      description: supplierInvoiceLines.description,
      quantity: supplierInvoiceLines.quantity,
      unitPrice: supplierInvoiceLines.unitPrice,
      amountForeign: supplierInvoiceLines.amountForeign,
      amountBase: supplierInvoiceLines.amountBase,
    })
    .from(supplierInvoiceLines)
    .where(eq(supplierInvoiceLines.invoiceId, invoiceId))
    .orderBy(asc(supplierInvoiceLines.lineNo));
}

async function requireInvoice(reader: Reader, id: string) {
  const [header] = await reader
    .select(invoiceColumns)
    .from(supplierInvoices)
    .where(eq(supplierInvoices.id, id))
    .limit(1);
  if (!header) throw notFound("Invoice pemasok tidak ditemukan.");
  const lines = await loadLines(reader, id);
  return { ...header, lines };
}

async function lockInvoice(tx: Tx, id: string) {
  const [row] = await tx
    .select(invoiceColumns)
    .from(supplierInvoices)
    .where(eq(supplierInvoices.id, id))
    .for("update")
    .limit(1);
  if (!row) throw notFound("Invoice pemasok tidak ditemukan.");
  return row;
}

type InvoiceLineInput = CreateSupplierInvoiceInput["lines"][number];

/**
 * Three-way match (harga terkunci ke PO; selisih > pembulatan ditolak — PPV ditunda).
 * Kembalikan nominal foreign per baris + productId turunan dari baris PO.
 */
async function matchLines(tx: Tx, poId: string, lines: InvoiceLineInput[]) {
  const po = await requirePostedPurchaseOrder(tx, poId);
  const poLineById = new Map(po.lines.map((l) => [l.id, l]));

  const seen = new Set<string>();
  const resolved: {
    poLineId: string;
    productId: string;
    description: string | null;
    quantity: string;
    unitPrice: string;
    amountForeign: string;
  }[] = [];

  for (const [index, line] of lines.entries()) {
    const path = `lines.${index}`;
    const poLine = poLineById.get(line.poLineId);
    if (!poLine) {
      throw validationFailed([
        { path: `${path}.poLineId`, message: "Baris PO bukan milik purchase order ini." },
      ]);
    }
    if (seen.has(line.poLineId)) {
      throw conflict(`Baris PO ganda pada baris ${index + 1}; gabungkan dalam satu baris.`);
    }
    seen.add(line.poLineId);

    // Qty menagih <= jumlah diterima (goods received).
    if (cmp(line.quantity, poLine.quantityReceived) > 0) {
      throw businessRule(
        `Jumlah ditagih (${line.quantity}) melebihi jumlah diterima (${poLine.quantityReceived}) pada baris ${index + 1}.`,
      );
    }

    // Harga harus menempel PO; selisih nilai > pembulatan (±0.01/baris) -> BUSINESS_RULE.
    const amountForeign = round(mul(line.quantity, line.unitPrice), TOTAL_DP).toFixed(TOTAL_DP);
    const expected = round(mul(line.quantity, poLine.unitPrice), TOTAL_DP).toFixed(TOTAL_DP);
    const diff = dec(amountForeign).minus(expected).abs();
    if (cmp(diff.toFixed(TOTAL_DP), PRICE_TOLERANCE) > 0) {
      throw businessRule(
        `Selisih harga invoice vs PO (${amountForeign} ≠ ${expected}) di luar toleransi pada baris ${index + 1}.`,
      );
    }

    resolved.push({
      poLineId: line.poLineId,
      productId: poLine.productId,
      description: line.description ?? null,
      quantity: toDb(line.quantity, QTY_DP),
      unitPrice: toDb(line.unitPrice, 4),
      amountForeign,
    });
  }

  return { currency: po.currency, supplierId: po.supplierId, branchId: po.branchId, resolved };
}

/* ------------------------------------------------------------------ */
/* Baca                                                                */
/* ------------------------------------------------------------------ */

/** Posisi utang terbuka per pemasok (invoice posted belum lunas), urut jatuh tempo. Izin: purchasing.ap.read */
export async function listOpenInvoices(actor: AuthContext, supplierId: string, externalTx?: Tx) {
  assertCan(actor, "purchasing.ap.read");
  return loadOpenInvoicesForSupplier(externalTx ?? db, supplierId);
}

export async function listSupplierInvoices(
  actor: AuthContext,
  query: ListSupplierInvoicesQuery = {},
  externalTx?: Tx,
) {
  assertCan(actor, "purchasing.invoices.read");
  const reader = externalTx ?? db;
  const parsed = listSupplierInvoicesQuerySchema.parse(query);

  const conditions: (SQL | undefined)[] = [
    parsed.status === undefined ? undefined : eq(supplierInvoices.status, parsed.status),
    parsed.supplierId === undefined ? undefined : eq(supplierInvoices.supplierId, parsed.supplierId),
    parsed.poId === undefined ? undefined : eq(supplierInvoices.poId, parsed.poId),
  ];

  return reader
    .select(invoiceColumns)
    .from(supplierInvoices)
    .where(and(...conditions))
    .orderBy(desc(supplierInvoices.invoiceDate), desc(supplierInvoices.id));
}

export async function getSupplierInvoice(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "purchasing.invoices.read");
  return requireInvoice(externalTx ?? db, id);
}

/* ------------------------------------------------------------------ */
/* Tulis: draf                                                         */
/* ------------------------------------------------------------------ */

export async function createSupplierInvoice(
  actor: AuthContext,
  input: CreateSupplierInvoiceInput,
  externalTx?: Tx,
) {
  assertCan(actor, "purchasing.invoices.manage");
  const parsed = createSupplierInvoiceSchema.parse(input);

  const run = async (tx: Tx) => {
    if (parsed.dueDate < parsed.invoiceDate) {
      throw conflict("Jatuh tempo tidak boleh sebelum tanggal invoice.");
    }
    const { currency, supplierId, branchId, resolved } = await matchLines(tx, parsed.poId, parsed.lines);

    const totalForeign = toDb(
      sum(resolved.map((l) => l.amountForeign)),
      TOTAL_DP,
    );

    const [header] = await tx
      .insert(supplierInvoices)
      .values({
        status: "draft",
        supplierId,
        poId: parsed.poId,
        branchId,
        invoiceDate: parsed.invoiceDate,
        dueDate: parsed.dueDate,
        currency,
        totalForeign,
        totalBase: "0.00",
        notes: parsed.notes ?? null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: supplierInvoices.id });
    if (!header) throw new Error("Gagal membuat invoice pemasok.");

    await tx.insert(supplierInvoiceLines).values(
      resolved.map((line, index) => ({
        invoiceId: header.id,
        lineNo: index + 1,
        poLineId: line.poLineId,
        productId: line.productId,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        amountForeign: line.amountForeign,
        amountBase: "0.00",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })),
    );

    await audit.log(
      {
        action: "supplier_invoice.create",
        entityType: "supplier_invoice",
        entityId: header.id,
        actorId: actor.userId,
        after: { poId: parsed.poId, currency, lineCount: resolved.length, totalForeign },
      },
      tx,
    );

    return requireInvoice(tx, header.id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function updateSupplierInvoice(
  actor: AuthContext,
  id: string,
  input: UpdateSupplierInvoiceInput,
  externalTx?: Tx,
) {
  assertCan(actor, "purchasing.invoices.manage");
  const parsed = updateSupplierInvoiceSchema.parse(input);

  const run = async (tx: Tx) => {
    const current = await lockInvoice(tx, id);
    if (current.status !== "draft") {
      throw businessRule("Hanya invoice berstatus draft yang dapat diubah.");
    }

    const invoiceDate = parsed.invoiceDate ?? current.invoiceDate;
    const dueDate = parsed.dueDate ?? current.dueDate;
    if (dueDate < invoiceDate) {
      throw conflict("Jatuh tempo tidak boleh sebelum tanggal invoice.");
    }

    const { resolved } = await matchLines(tx, current.poId, parsed.lines);
    const totalForeign = toDb(
      sum(resolved.map((l) => l.amountForeign)),
      TOTAL_DP,
    );

    await tx.delete(supplierInvoiceLines).where(eq(supplierInvoiceLines.invoiceId, id));
    await tx
      .update(supplierInvoices)
      .set({
        invoiceDate,
        dueDate,
        totalForeign,
        notes: parsed.notes === undefined ? current.notes : parsed.notes,
        updatedBy: actor.userId,
        updatedAt: new Date(),
      })
      .where(eq(supplierInvoices.id, id));

    await tx.insert(supplierInvoiceLines).values(
      resolved.map((line, index) => ({
        invoiceId: id,
        lineNo: index + 1,
        poLineId: line.poLineId,
        productId: line.productId,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        amountForeign: line.amountForeign,
        amountBase: "0.00",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })),
    );

    await audit.log(
      {
        action: "supplier_invoice.update",
        entityType: "supplier_invoice",
        entityId: id,
        actorId: actor.userId,
        after: { lineCount: resolved.length, totalForeign },
      },
      tx,
    );

    return requireInvoice(tx, id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

/* ------------------------------------------------------------------ */
/* Transisi: post / cancel / reverse                                   */
/* ------------------------------------------------------------------ */

/**
 * draft -> posted. Snapshot kurs pada tanggal invoice, hitung amountBase baris +
 * totalBase, terbitkan jurnal GR/IR perpetual (Dr GR/IR / Cr AP dalam IDR dasar),
 * isi docNo + journalEntryId.
 */
export async function postSupplierInvoice(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "purchasing.invoices.post");

  const run = async (tx: Tx) => {
    const current = await lockInvoice(tx, id);
    if (current.status !== "draft") {
      throw businessRule("Hanya invoice berstatus draft yang dapat diposting.");
    }

    const lines = await loadLines(tx, id);
    if (lines.length === 0) throw businessRule("Invoice tidak memiliki baris untuk diposting.");

    const { rate } = await resolveRateToBase(tx, current.currency, current.invoiceDate);

    let totalBase = dec(0);
    for (const line of lines) {
      const lineBase = round(mul(line.amountForeign, rate), TOTAL_DP);
      totalBase = totalBase.plus(lineBase);
      await tx
        .update(supplierInvoiceLines)
        .set({ amountBase: toDb(lineBase, TOTAL_DP), updatedBy: actor.userId, updatedAt: new Date() })
        .where(eq(supplierInvoiceLines.id, line.id));
    }
    const totalBaseStr = toDb(totalBase, TOTAL_DP);

    const { grirAccountId, apAccountId } = await resolveApAccountIds(tx);

    const systemDraft = await createSystemDraft(tx, actor, {
      entryDate: current.invoiceDate,
      description: `Invoice pemasok ${current.docNo ?? current.id}`,
      lines: [
        { accountId: grirAccountId, side: "debit", amount: totalBaseStr },
        { accountId: apAccountId, side: "credit", amount: totalBaseStr },
      ],
      sourceType: SOURCE_INVOICE,
      sourceId: current.id,
      sourceEvent: "post",
    });
    const posted = await postJournal(actor, systemDraft.id, tx);

    const docNo = await nextDocumentNumber(tx, "supplier_invoice", { date: current.invoiceDate });

    await tx
      .update(supplierInvoices)
      .set({
        status: "posted",
        docNo,
        exchangeRate: rate,
        totalBase: totalBaseStr,
        journalEntryId: posted.id,
        postedAt: new Date(),
        updatedBy: actor.userId,
        updatedAt: new Date(),
      })
      .where(eq(supplierInvoices.id, id));

    await audit.log(
      {
        action: "supplier_invoice.post",
        entityType: "supplier_invoice",
        entityId: id,
        actorId: actor.userId,
        before: { status: "draft" },
        after: { status: "posted", docNo, exchangeRate: rate, totalBase: totalBaseStr, journalEntryId: posted.id },
      },
      tx,
    );

    return requireInvoice(tx, id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

/** draft -> cancelled (belum menyentuh buku besar). */
export async function cancelSupplierInvoice(
  actor: AuthContext,
  id: string,
  input: { reason: string },
  externalTx?: Tx,
) {
  assertCan(actor, "purchasing.invoices.manage");

  const run = async (tx: Tx) => {
    const current = await lockInvoice(tx, id);
    if (current.status !== "draft") {
      throw businessRule("Hanya invoice berstatus draft yang dapat dibatalkan. Gunakan reversal untuk invoice posted.");
    }

    await tx
      .update(supplierInvoices)
      .set({
        status: "cancelled",
        reason: input.reason,
        cancelledAt: new Date(),
        updatedBy: actor.userId,
        updatedAt: new Date(),
      })
      .where(eq(supplierInvoices.id, id));

    await audit.log(
      {
        action: "supplier_invoice.cancel",
        entityType: "supplier_invoice",
        entityId: id,
        actorId: actor.userId,
        before: { status: "draft" },
        after: { status: "cancelled", reason: input.reason },
      },
      tx,
    );

    return requireInvoice(tx, id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

/** posted -> reversed: reverseJournal jurnal GR/IR + status reversed. */
export async function reverseSupplierInvoice(
  actor: AuthContext,
  id: string,
  input: { reason: string },
  externalTx?: Tx,
) {
  assertCan(actor, "purchasing.invoices.post");

  const run = async (tx: Tx) => {
    const current = await lockInvoice(tx, id);
    if (current.status !== "posted") {
      throw businessRule("Hanya invoice berstatus posted yang dapat direversal.");
    }
    if (!current.journalEntryId) {
      throw businessRule("Invoice posted tanpa jurnal terkait; tidak dapat direversal.");
    }

    await reverseJournal(actor, current.journalEntryId, { reason: input.reason }, tx);

    await tx
      .update(supplierInvoices)
      .set({
        status: "reversed",
        reason: input.reason,
        reversedAt: new Date(),
        updatedBy: actor.userId,
        updatedAt: new Date(),
      })
      .where(eq(supplierInvoices.id, id));

    await audit.log(
      {
        action: "supplier_invoice.reverse",
        entityType: "supplier_invoice",
        entityId: id,
        actorId: actor.userId,
        before: { status: "posted" },
        after: { status: "reversed", reason: input.reason },
      },
      tx,
    );

    return requireInvoice(tx, id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

/** Invoice posted dengan sisa (totalBase - alokasi posted) per supplier, urut jatuh tempo. */
export type OpenInvoice = {
  id: string;
  docNo: string | null;
  currency: string;
  dueDate: string;
  exchangeRate: string;
  remainingBase: string;
  remainingForeign: string;
};

export async function loadOpenInvoicesForSupplier(
  tx: Reader,
  supplierId: string,
): Promise<OpenInvoice[]> {
  const invoices = await tx
    .select({
      id: supplierInvoices.id,
      docNo: supplierInvoices.docNo,
      currency: supplierInvoices.currency,
      dueDate: supplierInvoices.dueDate,
      exchangeRate: supplierInvoices.exchangeRate,
      totalBase: supplierInvoices.totalBase,
      totalForeign: supplierInvoices.totalForeign,
    })
    .from(supplierInvoices)
    .where(
      and(
        eq(supplierInvoices.supplierId, supplierId),
        eq(supplierInvoices.status, "posted"),
      ),
    )
    .orderBy(asc(supplierInvoices.dueDate), asc(supplierInvoices.id));

  if (invoices.length === 0) return [];

  // Jumlah alokasi per invoice dari pembayaran posted (reversed/cancelled tidak dihitung).
  const sums = await getAllocatedBaseByInvoice(
    tx,
    invoices.map((i) => i.id),
  );

  const result: OpenInvoice[] = [];
  for (const inv of invoices) {
    const allocatedBase = sums.get(inv.id) ?? "0.00";
    const remainingBase = toDb(dec(inv.totalBase).minus(allocatedBase).toFixed(TOTAL_DP), TOTAL_DP);
    if (cmp(remainingBase, "0") > 0) {
      const rate = inv.exchangeRate ?? "1.000000";
      const remainingForeign = toDb(div(remainingBase, rate), TOTAL_DP);
      result.push({
        id: inv.id,
        docNo: inv.docNo,
        currency: inv.currency,
        dueDate: inv.dueDate,
        exchangeRate: rate,
        remainingBase,
        remainingForeign,
      });
    }
  }
  return result;
}

/** Muat total alokasi (basis) per invoice dari pembayaran AP yang posted. */
async function getAllocatedBaseByInvoice(tx: Reader, invoiceIds: string[]): Promise<Map<string, string>> {
  if (invoiceIds.length === 0) return new Map();
  const rows = await tx
    .select({
      invoiceId: apPaymentAllocations.invoiceId,
      allocated: sql<string>`coalesce(sum(${apPaymentAllocations.amountBase}), '0')`,
    })
    .from(apPaymentAllocations)
    .innerJoin(apPayments, eq(apPayments.id, apPaymentAllocations.paymentId))
    .where(and(inArray(apPaymentAllocations.invoiceId, invoiceIds), eq(apPayments.status, "posted")))
    .groupBy(apPaymentAllocations.invoiceId);
  return new Map(rows.map((r) => [r.invoiceId, toDb(r.allocated, TOTAL_DP)]));
}
