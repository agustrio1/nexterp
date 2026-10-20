import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";

import { approvalRequests, salesOrderLines, salesOrders } from "@/db/schema";
import type { CreateSalesOrderInput, ListSalesQuery, UpdateSalesOrderInput } from "@/modules/sales/schemas";
import { assertActiveBranch, assertActiveCurrency, assertCan, requireActiveCustomer, requireSellableProduct } from "@/modules/sales/_refs";
import { resolveRateToBase } from "@/modules/organization/currency-service";
import { add, cmp, mul, round, sum, toDb } from "@/lib/money";
import { submitApproval } from "@/modules/core/approval-service";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { businessRule, conflict, notFound } from "@/server/errors";
import { nextDocumentNumber } from "@/server/numbering";
import type { AuthContext } from "@/server/authz";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Tx | typeof db;

const SO_DOC_TYPE = "sales_order";
const QTY_DP = 3;
const TOTAL_DP = 2;

const soColumns = {
  id: salesOrders.id,
  docNo: salesOrders.docNo,
  status: salesOrders.status,
  quotationId: salesOrders.quotationId,
  customerId: salesOrders.customerId,
  branchId: salesOrders.branchId,
  orderDate: salesOrders.orderDate,
  expectedDate: salesOrders.expectedDate,
  currency: salesOrders.currency,
  exchangeRate: salesOrders.exchangeRate,
  totalBase: salesOrders.totalBase,
  description: salesOrders.description,
  notes: salesOrders.notes,
  approvedAt: salesOrders.approvedAt,
  postedAt: salesOrders.postedAt,
  cancelledAt: salesOrders.cancelledAt,
  reason: salesOrders.reason,
  createdAt: salesOrders.createdAt,
  updatedAt: salesOrders.updatedAt,
};

async function loadLines(reader: Reader, soId: string) {
  return reader
    .select({
      id: salesOrderLines.id,
      soId: salesOrderLines.soId,
      lineNo: salesOrderLines.lineNo,
      productId: salesOrderLines.productId,
      description: salesOrderLines.description,
      quantity: salesOrderLines.quantity,
      unitPrice: salesOrderLines.unitPrice,
      amountForeign: salesOrderLines.amountForeign,
      baseAmount: salesOrderLines.baseAmount,
      quantityDelivered: salesOrderLines.quantityDelivered,
    })
    .from(salesOrderLines)
    .where(eq(salesOrderLines.soId, soId))
    .orderBy(asc(salesOrderLines.lineNo));
}

async function requireSo(reader: Reader, id: string) {
  const [header] = await reader.select(soColumns).from(salesOrders).where(eq(salesOrders.id, id)).limit(1);
  if (!header) throw notFound("Sales order tidak ditemukan.");
  const lines = await loadLines(reader, id);
  return { ...header, lines };
}

async function lockSo(tx: Tx, id: string) {
  const [row] = await tx.select(soColumns).from(salesOrders).where(eq(salesOrders.id, id)).for("update").limit(1);
  if (!row) throw notFound("Sales order tidak ditemukan.");
  return row;
}

/* ----------------------------- Baca ------------------------------ */

export async function listSalesOrders(actor: AuthContext, query: ListSalesQuery = {}, externalTx?: Tx) {
  assertCan(actor, "sales.orders.read");
  const reader = externalTx ?? db;
  const conditions: (SQL | undefined)[] = [
    query.status === undefined ? undefined : eq(salesOrders.status, query.status as "draft"),
    query.customerId === undefined ? undefined : eq(salesOrders.customerId, query.customerId),
    query.branchId === undefined ? undefined : eq(salesOrders.branchId, query.branchId),
  ];
  return reader.select(soColumns).from(salesOrders).where(and(...conditions)).orderBy(desc(salesOrders.orderDate));
}

export async function getSalesOrder(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "sales.orders.read");
  return requireSo(externalTx ?? db, id);
}

/* ----------------------------- Tulis ----------------------------- */

export async function createSalesOrder(actor: AuthContext, input: CreateSalesOrderInput, externalTx?: Tx) {
  assertCan(actor, "sales.orders.manage");
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

    const [header] = await tx.insert(salesOrders).values({
      status: "draft",
      quotationId: input.quotationId ?? null,
      customerId: input.customerId,
      branchId: input.branchId,
      orderDate: input.orderDate,
      expectedDate: input.expectedDate ?? null,
      currency,
      totalBase: "0.00",
      description: input.description ?? null,
      notes: input.notes ?? null,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    }).returning({ id: salesOrders.id });

    await tx.insert(salesOrderLines).values(
      input.lines.map((line, index) => ({
        soId: header!.id,
        lineNo: index + 1,
        productId: line.productId,
        description: line.description ?? null,
        quantity: toDb(line.quantity, QTY_DP),
        unitPrice: toDb(line.unitPrice, 4),
        amountForeign: foreign[index] ?? "0.00",
        baseAmount: "0.00",
        quantityDelivered: "0.000",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })),
    );

    await audit.log({ action: "sales.so.create", entityType: "sales_order", entityId: header!.id, actorId: actor.userId }, tx);
    return requireSo(tx, header!.id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function updateSalesOrder(actor: AuthContext, id: string, input: UpdateSalesOrderInput, externalTx?: Tx) {
  assertCan(actor, "sales.orders.manage");
  const run = async (tx: Tx) => {
    const current = await lockSo(tx, id);
    if (current.status !== "draft") throw businessRule("Hanya sales order berstatus draft yang dapat diubah.");

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

    await tx.update(salesOrders).set({
      customerId: input.customerId ?? current.customerId,
      branchId: input.branchId ?? current.branchId,
      orderDate: input.orderDate ?? current.orderDate,
      expectedDate: input.expectedDate ?? current.expectedDate,
      currency,
      description: input.description ?? current.description,
      notes: input.notes ?? current.notes,
      updatedBy: actor.userId,
      updatedAt: new Date(),
    }).where(eq(salesOrders.id, id));

    await tx.delete(salesOrderLines).where(eq(salesOrderLines.soId, id));
    await tx.insert(salesOrderLines).values(
      input.lines.map((line, index) => ({
        soId: id,
        lineNo: index + 1,
        productId: line.productId,
        description: line.description ?? null,
        quantity: toDb(line.quantity, QTY_DP),
        unitPrice: toDb(line.unitPrice, 4),
        amountForeign: foreign[index] ?? "0.00",
        baseAmount: "0.00",
        quantityDelivered: "0.000",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })),
    );

    await audit.log({ action: "sales.so.update", entityType: "sales_order", entityId: id, actorId: actor.userId }, tx);
    return requireSo(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

/* -------------------------- Transisi status ----------------------- */

export async function submitSalesOrder(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "sales.orders.post");
  const run = async (tx: Tx) => {
    const current = await lockSo(tx, id);
    if (current.status !== "draft") throw businessRule("Hanya sales order berstatus draft yang dapat diajukan.");
    const lines = await loadLines(tx, id);
    if (lines.length === 0) throw businessRule("Sales order tidak memiliki baris.");
    const foreign = lines.map((l) => l.amountForeign);
    const { rate } = await resolveRateToBase(tx, current.currency, current.orderDate);
    const totalBase = toDb(sum(foreign.map((f) => round(mul(f, rate), TOTAL_DP))), TOTAL_DP);
    await submitApproval(actor, { docType: SO_DOC_TYPE, docId: id, amount: totalBase, branchId: current.branchId }, tx);
    await tx.update(salesOrders).set({ status: "pending_approval", updatedBy: actor.userId, updatedAt: new Date() }).where(eq(salesOrders.id, id));
    await audit.log({ action: "sales.so.submit", entityType: "sales_order", entityId: id, actorId: actor.userId, after: { status: "pending_approval" } }, tx);
    return requireSo(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function approveSalesOrder(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "sales.orders.post");
  const run = async (tx: Tx) => {
    const current = await lockSo(tx, id);
    if (current.status !== "pending_approval") throw businessRule("Hanya sales order berstatus pending_approval yang dapat disetujui.");
    const [req] = await tx.select({ status: approvalRequests.status }).from(approvalRequests)
      .where(and(eq(approvalRequests.docType, SO_DOC_TYPE), eq(approvalRequests.docId, id), eq(approvalRequests.status, "approved"))).limit(1);
    if (!req) throw businessRule("Pengajuan persetujuan SO ini belum disetujui sepenuhnya.");
    await tx.update(salesOrders).set({ status: "approved", approvedAt: new Date(), updatedBy: actor.userId, updatedAt: new Date() }).where(eq(salesOrders.id, id));
    await audit.log({ action: "sales.so.approve", entityType: "sales_order", entityId: id, actorId: actor.userId, after: { status: "approved" } }, tx);
    return requireSo(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

/** approved → posted. Credit limit check + kurs + docNo. */
export async function postSalesOrder(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "sales.orders.post");
  const run = async (tx: Tx) => {
    const current = await lockSo(tx, id);
    if (current.status !== "approved") throw businessRule("Hanya sales order berstatus approved yang dapat diposting.");

    const lines = await loadLines(tx, id);
    if (lines.length === 0) throw businessRule("Sales order tidak memiliki baris untuk diposting.");

    const { rate } = await resolveRateToBase(tx, current.currency, current.orderDate);
    let totalBase = add(0);
    for (const line of lines) {
      const lineBase = round(mul(line.amountForeign, rate), TOTAL_DP);
      totalBase = totalBase.plus(lineBase);
      await tx.update(salesOrderLines).set({ baseAmount: toDb(lineBase, TOTAL_DP), updatedBy: actor.userId, updatedAt: new Date() }).where(eq(salesOrderLines.id, line.id));
    }
    const totalBaseStr = toDb(totalBase, TOTAL_DP);

    // Credit limit check: outstanding AR + this SO must not exceed creditLimit
    const customer = await requireActiveCustomer(tx, current.customerId);
    if (customer.creditLimit && cmp(customer.creditLimit, "0") > 0) {
      const arResult = await tx.execute(sql`
        SELECT COALESCE(SUM(i.total_base - COALESCE(pa.allocated, 0)), 0)::text AS outstanding
        FROM customer_invoices i
        LEFT JOIN (
          SELECT invoice_id, SUM(ca.amount_base) AS allocated
          FROM customer_payment_allocations ca
          JOIN customer_payments cp ON cp.id = ca.payment_id AND cp.status = 'posted'
          GROUP BY ca.invoice_id
        ) pa ON pa.invoice_id = i.id
        WHERE i.customer_id = ${current.customerId} AND i.status = 'posted'
      `) as unknown as { rows: { outstanding: string }[] };
      const outstanding = arResult.rows[0]?.outstanding ?? "0.00";
      const newTotal = add(outstanding, totalBaseStr).toFixed(TOTAL_DP);
      if (cmp(newTotal, customer.creditLimit) > 0) {
        throw businessRule(`Batas kredit pelanggan terlampaui. Outstanding: ${outstanding}, SO: ${totalBaseStr}, Limit: ${customer.creditLimit}.`);
      }
    }

    const docNo = await nextDocumentNumber(tx, "sales_order", { date: current.orderDate });

    await tx.update(salesOrders).set({
      status: "posted", docNo, exchangeRate: rate, totalBase: totalBaseStr,
      postedAt: new Date(), updatedBy: actor.userId, updatedAt: new Date(),
    }).where(eq(salesOrders.id, id));

    await audit.log({ action: "sales.so.post", entityType: "sales_order", entityId: id, actorId: actor.userId, after: { status: "posted", docNo, totalBase: totalBaseStr } }, tx);
    return requireSo(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function cancelSalesOrder(actor: AuthContext, id: string, reason: string, externalTx?: Tx) {
  assertCan(actor, "sales.orders.manage");
  const run = async (tx: Tx) => {
    const current = await lockSo(tx, id);
    if (current.status === "posted") throw businessRule("Sales order yang sudah diposting tidak dapat dibatalkan.");
    if (current.status === "cancelled") throw businessRule("Sales order sudah dibatalkan.");
    await tx.update(salesOrders).set({ status: "cancelled", reason, cancelledAt: new Date(), updatedBy: actor.userId, updatedAt: new Date() }).where(eq(salesOrders.id, id));
    await audit.log({ action: "sales.so.cancel", entityType: "sales_order", entityId: id, actorId: actor.userId, after: { status: "cancelled", reason } }, tx);
    return requireSo(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

/* ------------------- Pembacaan untuk delivery/invoice ------------------- */

export async function requirePostedSo(tx: Tx, id: string) {
  const so = await requireSo(tx, id);
  if (so.status !== "posted") throw businessRule("Pengiriman hanya dapat dilakukan terhadap SO berstatus posted.");
  return so;
}

/** Helper: sisa qty per baris SO (ordered - delivered). */
export async function loadOpenSoLineQuantities(tx: Tx, soLineIds: string[]) {
  if (soLineIds.length === 0) return new Map<string, { productId: string; remaining: string }>();
  const { inArray } = await import("drizzle-orm");
  const rows = await tx.select({
    id: salesOrderLines.id, productId: salesOrderLines.productId,
    quantity: salesOrderLines.quantity, quantityDelivered: salesOrderLines.quantityDelivered,
  }).from(salesOrderLines).where(inArray(salesOrderLines.id, soLineIds)).for("update");

  const map = new Map<string, { productId: string; remaining: string }>();
  const { sub } = await import("@/lib/money");
  for (const row of rows) {
    const remaining = toDb(sub(row.quantity, row.quantityDelivered), QTY_DP);
    map.set(row.id, { productId: row.productId, remaining });
  }
  return map;
}
