import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";

import { customerInvoices, salesCreditNoteLines, salesCreditNotes } from "@/db/schema";
import type { CreateCreditNoteInput, ListSalesQuery } from "@/modules/sales/schemas";
import { assertActiveCurrency, assertCan } from "@/modules/sales/_refs";
import { requirePostedInvoice } from "@/modules/sales/invoice-service";
import { resolveArAccountIds } from "@/modules/sales/ar-account-config";
import { resolveRateToBase } from "@/modules/organization/currency-service";
import { createSystemDraft, postJournal, reverseJournal } from "@/modules/accounting/journal-service";
import { cmp, mul, round, sum, toDb } from "@/lib/money";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { businessRule, notFound, validationFailed } from "@/server/errors";
import { nextDocumentNumber } from "@/server/numbering";
import type { AuthContext } from "@/server/authz";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Tx | typeof db;

/** sourceType jurnal AR untuk nota kredit penjualan (Dr Revenue / Cr AR). */
const SOURCE_CREDIT_NOTE = "sales_credit_note";
const QTY_DP = 3;
const TOTAL_DP = 2;

const cnColumns = {
  id: salesCreditNotes.id,
  docNo: salesCreditNotes.docNo,
  status: salesCreditNotes.status,
  invoiceId: salesCreditNotes.invoiceId,
  customerId: salesCreditNotes.customerId,
  branchId: salesCreditNotes.branchId,
  creditNoteDate: salesCreditNotes.creditNoteDate,
  currency: salesCreditNotes.currency,
  exchangeRate: salesCreditNotes.exchangeRate,
  totalForeign: salesCreditNotes.totalForeign,
  totalBase: salesCreditNotes.totalBase,
  journalEntryId: salesCreditNotes.journalEntryId,
  reason: salesCreditNotes.reason,
  postedAt: salesCreditNotes.postedAt,
  cancelledAt: salesCreditNotes.cancelledAt,
  reversedAt: salesCreditNotes.reversedAt,
  createdAt: salesCreditNotes.createdAt,
  updatedAt: salesCreditNotes.updatedAt,
};

async function loadLines(reader: Reader, creditNoteId: string) {
  return reader
    .select({
      id: salesCreditNoteLines.id,
      creditNoteId: salesCreditNoteLines.creditNoteId,
      lineNo: salesCreditNoteLines.lineNo,
      invoiceLineId: salesCreditNoteLines.invoiceLineId,
      productId: salesCreditNoteLines.productId,
      description: salesCreditNoteLines.description,
      quantity: salesCreditNoteLines.quantity,
      unitPrice: salesCreditNoteLines.unitPrice,
      amountForeign: salesCreditNoteLines.amountForeign,
      amountBase: salesCreditNoteLines.amountBase,
    })
    .from(salesCreditNoteLines)
    .where(eq(salesCreditNoteLines.creditNoteId, creditNoteId))
    .orderBy(asc(salesCreditNoteLines.lineNo));
}

async function requireCreditNote(reader: Reader, id: string) {
  const [header] = await reader.select(cnColumns).from(salesCreditNotes).where(eq(salesCreditNotes.id, id)).limit(1);
  if (!header) throw notFound("Nota kredit penjualan tidak ditemukan.");
  const lines = await loadLines(reader, id);
  return { ...header, lines };
}

async function lockCreditNote(tx: Tx, id: string) {
  const [row] = await tx.select(cnColumns).from(salesCreditNotes).where(eq(salesCreditNotes.id, id)).for("update").limit(1);
  if (!row) throw notFound("Nota kredit penjualan tidak ditemukan.");
  return row;
}

/* ----------------------------- Baca ------------------------------ */

export async function listCreditNotes(actor: AuthContext, query: ListSalesQuery = {}, externalTx?: Tx) {
  assertCan(actor, "sales.credit_notes.read");
  const reader = externalTx ?? db;
  const conditions: (SQL | undefined)[] = [
    query.status === undefined ? undefined : eq(salesCreditNotes.status, query.status as "draft"),
    query.customerId === undefined ? undefined : eq(salesCreditNotes.customerId, query.customerId),
    query.branchId === undefined ? undefined : eq(salesCreditNotes.branchId, query.branchId),
  ];
  return reader.select(cnColumns).from(salesCreditNotes).where(and(...conditions)).orderBy(desc(salesCreditNotes.creditNoteDate));
}

export async function getCreditNote(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "sales.credit_notes.read");
  return requireCreditNote(externalTx ?? db, id);
}

/* ----------------------------- Tulis: draf ----------------------------- */

/** Buat nota kredit draf dari faktur posted. Total tidak melebihi nilai faktur (diverifikasi lagi saat post). */
export async function createCreditNote(actor: AuthContext, input: CreateCreditNoteInput, externalTx?: Tx) {
  assertCan(actor, "sales.credit_notes.manage");
  const run = async (tx: Tx) => {
    const invoice = await requirePostedInvoice(tx, input.invoiceId);
    if (invoice.branchId !== input.branchId) throw validationFailed([{ path: "branchId", message: "Cabang nota kredit harus sama dengan cabang faktur." }]);

    const currency = input.currency ?? invoice.currency;
    await assertActiveCurrency(tx, currency);

    const foreign = input.lines.map((l) => toDb(mul(l.quantity, l.unitPrice), TOTAL_DP));
    const totalForeign = toDb(sum(foreign), TOTAL_DP);
    if (cmp(totalForeign, "0") <= 0) throw businessRule("Nilai nota kredit harus lebih dari nol.");

    await assertNotExceedInvoice(tx, input.invoiceId, totalForeign, null);

    const [header] = await tx.insert(salesCreditNotes).values({
      status: "draft",
      invoiceId: input.invoiceId,
      customerId: invoice.customerId,
      branchId: invoice.branchId,
      creditNoteDate: input.creditNoteDate,
      currency,
      totalForeign,
      totalBase: "0.00",
      reason: input.reason,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    }).returning({ id: salesCreditNotes.id });

    await tx.insert(salesCreditNoteLines).values(
      input.lines.map((line, index) => ({
        creditNoteId: header!.id,
        lineNo: index + 1,
        invoiceLineId: line.invoiceLineId ?? null,
        productId: line.productId ?? null,
        description: line.description ?? null,
        quantity: toDb(line.quantity, QTY_DP),
        unitPrice: toDb(line.unitPrice, 4),
        amountForeign: foreign[index] ?? "0.00",
        amountBase: "0.00",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })),
    );

    await audit.log({ action: "sales.credit_note.create", entityType: "sales_credit_note", entityId: header!.id, actorId: actor.userId, after: { invoiceId: input.invoiceId, totalForeign } }, tx);
    return requireCreditNote(tx, header!.id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

/* -------------------------- Transisi: post ------------------------- */

/**
 * draft -> posted. Snapshot kurs, hitung totalBase, terbitkan jurnal Dr Revenue /
 * Cr AR senilai totalBase (mengurangi piutang). Nota kredit tidak memecah PPN
 * (disederhanakan sesuai skema header).
 */
export async function postCreditNote(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "sales.credit_notes.post");
  const run = async (tx: Tx) => {
    const current = await lockCreditNote(tx, id);
    if (current.status !== "draft") throw businessRule("Hanya nota kredit berstatus draft yang dapat diposting.");

    const invoice = await requirePostedInvoice(tx, current.invoiceId);
    const lines = await loadLines(tx, id);
    if (lines.length === 0) throw businessRule("Nota kredit tidak memiliki baris untuk diposting.");

    const { rate } = await resolveRateToBase(tx, current.currency, current.creditNoteDate);

    let totalBase = "0.00";
    for (const line of lines) {
      const lineBase = toDb(round(mul(line.amountForeign, rate), TOTAL_DP), TOTAL_DP);
      totalBase = toDb(sum([totalBase, lineBase]), TOTAL_DP);
      await tx.update(salesCreditNoteLines).set({ amountBase: lineBase, updatedBy: actor.userId, updatedAt: new Date() }).where(eq(salesCreditNoteLines.id, line.id));
    }
    if (cmp(totalBase, "0") <= 0) throw businessRule("Nilai basis nota kredit bernilai nol; periksa kurs.");

    await assertNotExceedInvoice(tx, current.invoiceId, current.totalForeign, id);

    const { arAccountId, revenueAccountId } = await resolveArAccountIds(tx);
    const draft = await createSystemDraft(tx, actor, {
      entryDate: current.creditNoteDate,
      description: `Nota kredit ${current.docNo ?? current.id} (faktur ${invoice.docNo ?? invoice.id})`,
      reference: invoice.docNo ?? undefined,
      lines: [
        { accountId: revenueAccountId, side: "debit", amount: totalBase },
        { accountId: arAccountId, side: "credit", amount: totalBase },
      ],
      sourceType: SOURCE_CREDIT_NOTE,
      sourceId: current.id,
      sourceEvent: "post",
    });
    const posted = await postJournal(actor, draft.id, tx);

    const docNo = await nextDocumentNumber(tx, "sales_credit_note", { date: current.creditNoteDate });

    await tx.update(salesCreditNotes).set({
      status: "posted", docNo, exchangeRate: rate, totalBase, journalEntryId: posted.id, postedAt: new Date(), updatedBy: actor.userId, updatedAt: new Date(),
    }).where(eq(salesCreditNotes.id, id));

    await audit.log({ action: "sales.credit_note.post", entityType: "sales_credit_note", entityId: id, actorId: actor.userId, after: { status: "posted", docNo, totalBase, journalEntryId: posted.id } }, tx);
    return requireCreditNote(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

/* -------------------------- Transisi: cancel ----------------------- */

export async function cancelCreditNote(actor: AuthContext, id: string, reason: string, externalTx?: Tx) {
  assertCan(actor, "sales.credit_notes.manage");
  const run = async (tx: Tx) => {
    const current = await lockCreditNote(tx, id);
    if (current.status !== "draft") throw businessRule("Hanya nota kredit berstatus draft yang dapat dibatalkan. Gunakan reversal untuk nota kredit posted.");
    await tx.update(salesCreditNotes).set({ status: "cancelled", reason, cancelledAt: new Date(), updatedBy: actor.userId, updatedAt: new Date() }).where(eq(salesCreditNotes.id, id));
    await audit.log({ action: "sales.credit_note.cancel", entityType: "sales_credit_note", entityId: id, actorId: actor.userId, after: { status: "cancelled", reason } }, tx);
    return requireCreditNote(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

/* -------------------------- Transisi: reverse ---------------------- */

export async function reverseCreditNote(actor: AuthContext, id: string, reason: string, externalTx?: Tx) {
  assertCan(actor, "sales.credit_notes.post");
  const run = async (tx: Tx) => {
    const current = await lockCreditNote(tx, id);
    if (current.status !== "posted") throw businessRule("Hanya nota kredit berstatus posted yang dapat dibalik.");
    if (!current.journalEntryId) throw businessRule("Nota kredit posted tanpa jurnal terkait; tidak dapat dibalik.");

    await reverseJournal(actor, current.journalEntryId, { reason }, tx);

    await tx.update(salesCreditNotes).set({ status: "reversed", reason, reversedAt: new Date(), updatedBy: actor.userId, updatedAt: new Date() }).where(eq(salesCreditNotes.id, id));
    await audit.log({ action: "sales.credit_note.reverse", entityType: "sales_credit_note", entityId: id, actorId: actor.userId, after: { status: "reversed", reason } }, tx);
    return requireCreditNote(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

/* ----------------------------- Guard ------------------------------- */

/**
 * Pastikan (foreign) nota kredit aktif pada satu faktur tidak melebihi nilai
 * faktur. `excludeId` mengabaikan CN yang sedang diperiksa (saat post).
 */
async function assertNotExceedInvoice(tx: Tx, invoiceId: string, amountForeign: string, excludeId: string | null): Promise<void> {
  const [invoice] = await tx
    .select({ totalForeign: customerInvoices.totalForeign })
    .from(customerInvoices)
    .where(eq(customerInvoices.id, invoiceId))
    .limit(1);
  if (!invoice) throw notFound("Faktur penjualan tidak ditemukan.");

  const cond = excludeId === null
    ? and(eq(salesCreditNotes.invoiceId, invoiceId), sql`${salesCreditNotes.status} in ('draft', 'posted')`)
    : and(eq(salesCreditNotes.invoiceId, invoiceId), sql`${salesCreditNotes.status} in ('draft', 'posted')`, sql`${salesCreditNotes.id} <> ${excludeId}`);
  const [existing] = await tx
    .select({ total: sql<string>`coalesce(sum(${salesCreditNotes.totalForeign}), '0')` })
    .from(salesCreditNotes)
    .where(cond);
  const projected = toDb(sum([existing?.total ?? "0.00", amountForeign]), TOTAL_DP);
  if (cmp(projected, invoice.totalForeign) > 0) {
    throw businessRule(`Total nota kredit (${projected}) melebihi nilai faktur (${invoice.totalForeign}).`);
  }
}
