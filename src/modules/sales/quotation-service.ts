import { and, asc, desc, eq, type SQL } from "drizzle-orm";

import { salesQuotationLines, salesQuotations } from "@/db/schema";
import type { CreateQuotationInput, ListSalesQuery, UpdateQuotationInput } from "@/modules/sales/schemas";
import { assertActiveBranch, assertActiveCurrency, assertCan, requireActiveCustomer, requireSellableProduct } from "@/modules/sales/_refs";
import { mul, round, toDb } from "@/lib/money";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { businessRule, conflict, notFound } from "@/server/errors";
import type { AuthContext } from "@/server/authz";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Tx | typeof db;

const QTY_DP = 3;
const TOTAL_DP = 2;

const sqColumns = {
  id: salesQuotations.id,
  docNo: salesQuotations.docNo,
  status: salesQuotations.status,
  customerId: salesQuotations.customerId,
  branchId: salesQuotations.branchId,
  quotationDate: salesQuotations.quotationDate,
  validUntil: salesQuotations.validUntil,
  currency: salesQuotations.currency,
  exchangeRate: salesQuotations.exchangeRate,
  totalBase: salesQuotations.totalBase,
  description: salesQuotations.description,
  notes: salesQuotations.notes,
  createdAt: salesQuotations.createdAt,
  updatedAt: salesQuotations.updatedAt,
};

async function loadLines(reader: Reader, sqId: string) {
  return reader
    .select({
      id: salesQuotationLines.id,
      lineNo: salesQuotationLines.lineNo,
      productId: salesQuotationLines.productId,
      description: salesQuotationLines.description,
      quantity: salesQuotationLines.quantity,
      unitPrice: salesQuotationLines.unitPrice,
      amountForeign: salesQuotationLines.amountForeign,
      baseAmount: salesQuotationLines.baseAmount,
    })
    .from(salesQuotationLines)
    .where(eq(salesQuotationLines.quotationId, sqId))
    .orderBy(asc(salesQuotationLines.lineNo));
}

async function requireQuotation(reader: Reader, id: string) {
  const [header] = await reader.select(sqColumns).from(salesQuotations).where(eq(salesQuotations.id, id)).limit(1);
  if (!header) throw notFound("Penawaran tidak ditemukan.");
  const lines = await loadLines(reader, id);
  return { ...header, lines };
}

async function lockQuotation(tx: Tx, id: string) {
  const [row] = await tx.select(sqColumns).from(salesQuotations).where(eq(salesQuotations.id, id)).for("update").limit(1);
  if (!row) throw notFound("Penawaran tidak ditemukan.");
  return row;
}

/* ----------------------------- Baca ------------------------------ */

export async function listQuotations(actor: AuthContext, query: ListSalesQuery = {}, externalTx?: Tx) {
  assertCan(actor, "sales.quotations.read");
  const reader = externalTx ?? db;
  const conditions: (SQL | undefined)[] = [
    query.status === undefined ? undefined : eq(salesQuotations.status, query.status as "draft"),
    query.customerId === undefined ? undefined : eq(salesQuotations.customerId, query.customerId),
    query.branchId === undefined ? undefined : eq(salesQuotations.branchId, query.branchId),
  ];
  return reader.select(sqColumns).from(salesQuotations).where(and(...conditions)).orderBy(desc(salesQuotations.quotationDate));
}

export async function getQuotation(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "sales.quotations.read");
  return requireQuotation(externalTx ?? db, id);
}

/* ----------------------------- Tulis ----------------------------- */

export async function createQuotation(actor: AuthContext, input: CreateQuotationInput, externalTx?: Tx) {
  assertCan(actor, "sales.quotations.manage");
  const run = async (tx: Tx) => {
    const customer = await requireActiveCustomer(tx, input.customerId);
    await assertActiveBranch(tx, input.branchId);
    const currency = input.currency ?? customer.currency;
    await assertActiveCurrency(tx, currency);

    const seen = new Set<string>();
    const foreign: string[] = [];
    for (const line of input.lines) {
      await requireSellableProduct(tx, line.productId);
      if (seen.has(line.productId)) throw conflict(`Produk ganda: ${line.productId}`);
      seen.add(line.productId);
      foreign.push(round(mul(line.quantity, line.unitPrice), TOTAL_DP).toFixed(TOTAL_DP));
    }

    const [header] = await tx.insert(salesQuotations).values({
      status: "draft",
      customerId: input.customerId,
      branchId: input.branchId,
      quotationDate: input.quotationDate,
      validUntil: input.validUntil ?? null,
      currency,
      totalBase: "0.00",
      description: input.description ?? null,
      notes: input.notes ?? null,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    }).returning({ id: salesQuotations.id });

    await tx.insert(salesQuotationLines).values(
      input.lines.map((line, index) => ({
        quotationId: header!.id,
        lineNo: index + 1,
        productId: line.productId,
        description: line.description ?? null,
        quantity: toDb(line.quantity, QTY_DP),
        unitPrice: toDb(line.unitPrice, 4),
        amountForeign: foreign[index] ?? "0.00",
        baseAmount: "0.00",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })),
    );

    await audit.log({ action: "sales.quotation.create", entityType: "sales_quotation", entityId: header!.id, actorId: actor.userId }, tx);
    return requireQuotation(tx, header!.id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function updateQuotation(actor: AuthContext, id: string, input: UpdateQuotationInput, externalTx?: Tx) {
  assertCan(actor, "sales.quotations.manage");
  const run = async (tx: Tx) => {
    const current = await lockQuotation(tx, id);
    if (current.status !== "draft") throw businessRule("Hanya penawaran berstatus draft yang dapat diubah.");

    const customer = await requireActiveCustomer(tx, input.customerId ?? current.customerId);
    await assertActiveBranch(tx, input.branchId ?? current.branchId);
    const currency = input.currency ?? current.currency ?? customer.currency;
    await assertActiveCurrency(tx, currency);

    const seen = new Set<string>();
    const foreign: string[] = [];
    for (const line of input.lines) {
      await requireSellableProduct(tx, line.productId);
      if (seen.has(line.productId)) throw conflict(`Produk ganda: ${line.productId}`);
      seen.add(line.productId);
      foreign.push(round(mul(line.quantity, line.unitPrice), TOTAL_DP).toFixed(TOTAL_DP));
    }

    await tx.update(salesQuotations).set({
      customerId: input.customerId ?? current.customerId,
      branchId: input.branchId ?? current.branchId,
      quotationDate: input.quotationDate ?? current.quotationDate,
      validUntil: input.validUntil ?? current.validUntil,
      currency,
      description: input.description ?? current.description,
      notes: input.notes ?? current.notes,
      updatedBy: actor.userId,
      updatedAt: new Date(),
    }).where(eq(salesQuotations.id, id));

    await tx.delete(salesQuotationLines).where(eq(salesQuotationLines.quotationId, id));
    await tx.insert(salesQuotationLines).values(
      input.lines.map((line, index) => ({
        quotationId: id,
        lineNo: index + 1,
        productId: line.productId,
        description: line.description ?? null,
        quantity: toDb(line.quantity, QTY_DP),
        unitPrice: toDb(line.unitPrice, 4),
        amountForeign: foreign[index] ?? "0.00",
        baseAmount: "0.00",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })),
    );

    await audit.log({ action: "sales.quotation.update", entityType: "sales_quotation", entityId: id, actorId: actor.userId }, tx);
    return requireQuotation(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

/* -------------------------- Transisi status ----------------------- */

async function transitionQuotation(actor: AuthContext, id: string, from: string, to: string, action: string, externalTx?: Tx) {
  const run = async (tx: Tx) => {
    const current = await lockQuotation(tx, id);
    if (current.status !== from) throw businessRule(`Status harus '${from}', saat ini '${current.status}'.`);
    await tx.update(salesQuotations).set({ status: to as "sent", updatedBy: actor.userId, updatedAt: new Date() }).where(eq(salesQuotations.id, id));
    await audit.log({ action, entityType: "sales_quotation", entityId: id, actorId: actor.userId, after: { status: to } }, tx);
    return requireQuotation(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function sendQuotation(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "sales.quotations.manage");
  return transitionQuotation(actor, id, "draft", "sent", "sales.quotation.send", externalTx);
}

export async function acceptQuotation(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "sales.quotations.manage");
  return transitionQuotation(actor, id, "sent", "accepted", "sales.quotation.accept", externalTx);
}

export async function rejectQuotation(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "sales.quotations.manage");
  return transitionQuotation(actor, id, "sent", "rejected", "sales.quotation.reject", externalTx);
}

export async function cancelQuotation(actor: AuthContext, id: string, reason: string, externalTx?: Tx) {
  assertCan(actor, "sales.quotations.manage");
  const run = async (tx: Tx) => {
    const current = await lockQuotation(tx, id);
    if (current.status === "cancelled") throw businessRule("Penawaran sudah dibatalkan.");
    if (current.status === "accepted") throw businessRule("Penawaran yang sudah diterima tidak dapat dibatalkan.");
    await tx.update(salesQuotations).set({ status: "cancelled", reason, cancelledAt: new Date(), updatedBy: actor.userId, updatedAt: new Date() }).where(eq(salesQuotations.id, id));
    await audit.log({ action: "sales.quotation.cancel", entityType: "sales_quotation", entityId: id, actorId: actor.userId, after: { status: "cancelled", reason } }, tx);
    return requireQuotation(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}
