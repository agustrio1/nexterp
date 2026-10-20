import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm";

import { approvalRequests, purchaseOrderLines, purchaseOrders } from "@/db/schema";
import {
  cancelPurchaseOrderSchema,
  createPurchaseOrderSchema,
  listPurchaseOrdersQuerySchema,
  updatePurchaseOrderSchema,
  type CancelPurchaseOrderInput,
  type CreatePurchaseOrderInput,
  type ListPurchaseOrdersQuery,
  type UpdatePurchaseOrderInput,
} from "@/modules/purchasing/schemas";
import {
  assertActiveBranch,
  assertActiveCurrency,
  assertCan,
  requirePurchasableProduct,
} from "@/modules/purchasing/_refs";
import { requireActiveSupplier } from "@/modules/purchasing/supplier-service";
import { resolveRateToBase } from "@/modules/organization/currency-service";
import { add, cmp, div, mul, round, sub, sum, toDb } from "@/lib/money";
import { submitApproval } from "@/modules/core/approval-service";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { businessRule, conflict, notFound } from "@/server/errors";
import { nextDocumentNumber } from "@/server/numbering";
import type { AuthContext } from "@/server/authz";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Tx | typeof db;

/** doc_type yang dipakai mesin persetujuan 3J untuk purchase order. */
const PO_DOC_TYPE = "purchase_order";

const QTY_DP = 3;
const TOTAL_DP = 2;

/* ------------------------------------------------------------------ */
/* Pembaca bersama                                                     */
/* ------------------------------------------------------------------ */

const poColumns = {
  id: purchaseOrders.id,
  docNo: purchaseOrders.docNo,
  status: purchaseOrders.status,
  supplierId: purchaseOrders.supplierId,
  branchId: purchaseOrders.branchId,
  orderDate: purchaseOrders.orderDate,
  expectedDate: purchaseOrders.expectedDate,
  currency: purchaseOrders.currency,
  exchangeRate: purchaseOrders.exchangeRate,
  totalBase: purchaseOrders.totalBase,
  description: purchaseOrders.description,
  notes: purchaseOrders.notes,
  approvedAt: purchaseOrders.approvedAt,
  postedAt: purchaseOrders.postedAt,
  cancelledAt: purchaseOrders.cancelledAt,
  reason: purchaseOrders.reason,
  createdAt: purchaseOrders.createdAt,
  updatedAt: purchaseOrders.updatedAt,
};

async function loadLines(reader: Reader, poId: string) {
  return reader
    .select({
      id: purchaseOrderLines.id,
      poId: purchaseOrderLines.poId,
      lineNo: purchaseOrderLines.lineNo,
      productId: purchaseOrderLines.productId,
      description: purchaseOrderLines.description,
      quantity: purchaseOrderLines.quantity,
      unitPrice: purchaseOrderLines.unitPrice,
      amountForeign: purchaseOrderLines.amountForeign,
      baseAmount: purchaseOrderLines.baseAmount,
      quantityReceived: purchaseOrderLines.quantityReceived,
    })
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.poId, poId))
    .orderBy(asc(purchaseOrderLines.lineNo));
}

async function requirePurchaseOrder(reader: Reader, id: string) {
  const [header] = await reader
    .select(poColumns)
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, id))
    .limit(1);
  if (!header) throw notFound("Purchase order tidak ditemukan.");
  const lines = await loadLines(reader, id);
  return { ...header, lines };
}

/** Kunci header FOR UPDATE untuk transisi status (tidak digabung JOIN). */
async function lockPurchaseOrder(tx: Tx, id: string) {
  const [row] = await tx
    .select(poColumns)
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, id))
    .for("update")
    .limit(1);
  if (!row) throw notFound("Purchase order tidak ditemukan.");
  return row;
}

/* ------------------------------------------------------------------ */
/* Validasi bentuk & nominal                                           */
/* ------------------------------------------------------------------ */

type DraftLine = CreatePurchaseOrderInput["lines"][number];

/** Validasi baris draf + kembalikan amountForeign per baris (mata uang PO). */
async function validateDraftLines(
  tx: Tx,
  lines: DraftLine[],
): Promise<{ foreign: string[] }> {
  const seen = new Set<string>();
  const foreign: string[] = [];
  for (const [index, line] of lines.entries()) {
    const path = `lines.${index}`;
    await requirePurchasableProduct(tx, line.productId, `${path}.productId`);
    if (seen.has(line.productId)) {
      throw conflict(`Produk ganda pada baris ${index + 1}; gabungkan dalam satu baris.`);
    }
    seen.add(line.productId);
    foreign.push(round(mul(line.quantity, line.unitPrice), TOTAL_DP).toFixed(TOTAL_DP));
  }
  return { foreign };
}

/** Total dalam mata uang dasar dari subtotal foreign × kurs (untuk pencocokan approval). */
async function estimateBaseTotal(
  tx: Tx,
  currency: string,
  orderDate: string,
  foreign: string[],
): Promise<{ rate: string; totalBase: string }> {
  const { rate } = await resolveRateToBase(tx, currency, orderDate);
  const total = sum(foreign.map((f) => round(mul(f, rate), TOTAL_DP)));
  return { rate, totalBase: toDb(total, TOTAL_DP) };
}

/* ------------------------------------------------------------------ */
/* Baca                                                                */
/* ------------------------------------------------------------------ */

export async function listPurchaseOrders(
  actor: AuthContext,
  query: ListPurchaseOrdersQuery = {},
  externalTx?: Tx,
) {
  assertCan(actor, "purchasing.purchase_orders.read");
  const reader = externalTx ?? db;
  const parsed = listPurchaseOrdersQuerySchema.parse(query);

  const conditions: (SQL | undefined)[] = [
    parsed.status === undefined ? undefined : eq(purchaseOrders.status, parsed.status),
    parsed.supplierId === undefined ? undefined : eq(purchaseOrders.supplierId, parsed.supplierId),
    parsed.branchId === undefined ? undefined : eq(purchaseOrders.branchId, parsed.branchId),
  ];

  return reader
    .select(poColumns)
    .from(purchaseOrders)
    .where(and(...conditions))
    .orderBy(desc(purchaseOrders.orderDate), desc(purchaseOrders.id));
}

export async function getPurchaseOrder(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "purchasing.purchase_orders.read");
  return requirePurchaseOrder(externalTx ?? db, id);
}

/* ------------------------------------------------------------------ */
/* Tulis: draf                                                         */
/* ------------------------------------------------------------------ */

export async function createPurchaseOrder(
  actor: AuthContext,
  input: CreatePurchaseOrderInput,
  externalTx?: Tx,
) {
  assertCan(actor, "purchasing.purchase_orders.manage");
  const parsed = createPurchaseOrderSchema.parse(input);

  const run = async (tx: Tx) => {
    const supplier = await requireActiveSupplier(tx, parsed.supplierId);
    await assertActiveBranch(tx, parsed.branchId);

    const currency = parsed.currency ?? supplier.currency;
    await assertActiveCurrency(tx, currency);
    if (parsed.expectedDate && parsed.expectedDate < parsed.orderDate) {
      throw conflict("Tanggal pengiriman dipercepat tidak boleh sebelum tanggal PO.");
    }

    const { foreign } = await validateDraftLines(tx, parsed.lines);

    const [header] = await tx
      .insert(purchaseOrders)
      .values({
        status: "draft",
        supplierId: parsed.supplierId,
        branchId: parsed.branchId,
        orderDate: parsed.orderDate,
        expectedDate: parsed.expectedDate ?? null,
        currency,
        totalBase: "0.00",
        description: parsed.description ?? null,
        notes: parsed.notes ?? null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: purchaseOrders.id });
    if (!header) throw new Error("Gagal membuat purchase order.");

    await tx.insert(purchaseOrderLines).values(
      parsed.lines.map((line, index) => ({
        poId: header.id,
        lineNo: index + 1,
        productId: line.productId,
        description: line.description ?? null,
        quantity: toDb(line.quantity, QTY_DP),
        unitPrice: toDb(line.unitPrice, 4),
        amountForeign: foreign[index] ?? "0.00",
        baseAmount: "0.00",
        quantityReceived: "0.000",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })),
    );

    await audit.log(
      {
        action: "purchase_order.create",
        entityType: "purchase_order",
        entityId: header.id,
        actorId: actor.userId,
        after: { supplierId: parsed.supplierId, currency, lineCount: parsed.lines.length },
      },
      tx,
    );

    return requirePurchaseOrder(tx, header.id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function updatePurchaseOrder(
  actor: AuthContext,
  id: string,
  input: UpdatePurchaseOrderInput,
  externalTx?: Tx,
) {
  assertCan(actor, "purchasing.purchase_orders.manage");
  const parsed = updatePurchaseOrderSchema.parse(input);

  const run = async (tx: Tx) => {
    const current = await lockPurchaseOrder(tx, id);
    if (current.status !== "draft") {
      throw businessRule("Hanya purchase order berstatus draft yang dapat diubah.");
    }

    const supplierId = parsed.supplierId ?? current.supplierId;
    const branchId = parsed.branchId ?? current.branchId;
    const orderDate = parsed.orderDate ?? current.orderDate;
    const expectedDate =
      parsed.expectedDate === undefined ? current.expectedDate : parsed.expectedDate;

    const supplier = await requireActiveSupplier(tx, supplierId);
    await assertActiveBranch(tx, branchId);

    const currency = parsed.currency ?? current.currency ?? supplier.currency;
    await assertActiveCurrency(tx, currency);

    if (expectedDate && expectedDate < orderDate) {
      throw conflict("Tanggal pengiriman dipercepat tidak boleh sebelum tanggal PO.");
    }

    const { foreign } = await validateDraftLines(tx, parsed.lines);

    await tx
      .update(purchaseOrders)
      .set({
        supplierId,
        branchId,
        orderDate,
        expectedDate: expectedDate ?? null,
        currency,
        description: parsed.description === undefined ? current.description : parsed.description,
        notes: parsed.notes === undefined ? current.notes : parsed.notes,
        updatedBy: actor.userId,
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, id));

    await tx.delete(purchaseOrderLines).where(eq(purchaseOrderLines.poId, id));
    await tx.insert(purchaseOrderLines).values(
      parsed.lines.map((line, index) => ({
        poId: id,
        lineNo: index + 1,
        productId: line.productId,
        description: line.description ?? null,
        quantity: toDb(line.quantity, QTY_DP),
        unitPrice: toDb(line.unitPrice, 4),
        amountForeign: foreign[index] ?? "0.00",
        baseAmount: "0.00",
        quantityReceived: "0.000",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })),
    );

    await audit.log(
      {
        action: "purchase_order.update",
        entityType: "purchase_order",
        entityId: id,
        actorId: actor.userId,
        after: { supplierId, branchId, currency, lineCount: parsed.lines.length },
      },
      tx,
    );

    return requirePurchaseOrder(tx, id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function cancelPurchaseOrder(
  actor: AuthContext,
  id: string,
  input: CancelPurchaseOrderInput,
  externalTx?: Tx,
) {
  assertCan(actor, "purchasing.purchase_orders.manage");
  const parsed = cancelPurchaseOrderSchema.parse(input);

  const run = async (tx: Tx) => {
    const current = await lockPurchaseOrder(tx, id);
    if (current.status === "posted") {
      throw businessRule("Purchase order yang sudah diposting tidak dapat dibatalkan (koreksi via dokumen penerimaan).");
    }
    if (current.status === "cancelled") {
      throw businessRule("Purchase order sudah dibatalkan.");
    }

    await tx
      .update(purchaseOrders)
      .set({
        status: "cancelled",
        reason: parsed.reason,
        cancelledAt: new Date(),
        updatedBy: actor.userId,
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, id));

    await audit.log(
      {
        action: "purchase_order.cancel",
        entityType: "purchase_order",
        entityId: id,
        actorId: actor.userId,
        before: { status: current.status },
        after: { status: "cancelled", reason: parsed.reason },
      },
      tx,
    );

    return requirePurchaseOrder(tx, id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

/* ------------------------------------------------------------------ */
/* Transisi status: submit -> approve -> post                          */
/* ------------------------------------------------------------------ */

/** draft -> pending_approval (ajukan ke mesin 3J; nominal = taksiran total dasar). */
export async function submitPurchaseOrder(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "purchasing.purchase_orders.post");

  const run = async (tx: Tx) => {
    const current = await lockPurchaseOrder(tx, id);
    if (current.status !== "draft") {
      throw businessRule("Hanya purchase order berstatus draft yang dapat diajukan.");
    }

    const lines = await loadLines(tx, id);
    if (lines.length === 0) throw businessRule("Purchase order tidak memiliki baris.");
    const foreign = lines.map((l) => l.amountForeign);
    const { totalBase } = await estimateBaseTotal(tx, current.currency, current.orderDate, foreign);

    await submitApproval(
      actor,
      { docType: PO_DOC_TYPE, docId: id, amount: totalBase, branchId: current.branchId },
      tx,
    );

    await tx
      .update(purchaseOrders)
      .set({ status: "pending_approval", updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(purchaseOrders.id, id));

    await audit.log(
      {
        action: "purchase_order.submit",
        entityType: "purchase_order",
        entityId: id,
        actorId: actor.userId,
        before: { status: "draft" },
        after: { status: "pending_approval", amount: totalBase },
      },
      tx,
    );

    return requirePurchaseOrder(tx, id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

/** pending_approval -> approved (menuntut approval_request 'approved' dari mesin 3J). */
export async function approvePurchaseOrder(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "purchasing.purchase_orders.post");

  const run = async (tx: Tx) => {
    const current = await lockPurchaseOrder(tx, id);
    if (current.status !== "pending_approval") {
      throw businessRule("Hanya purchase order berstatus pending_approval yang dapat disetujui.");
    }

    const [req] = await tx
      .select({ status: approvalRequests.status })
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.docType, PO_DOC_TYPE),
          eq(approvalRequests.docId, id),
          eq(approvalRequests.status, "approved"),
        ),
      )
      .limit(1);
    if (!req) {
      throw businessRule("Pengajuan persetujuan untuk PO ini belum disetujui sepenuhnya.");
    }

    await tx
      .update(purchaseOrders)
      .set({ status: "approved", approvedAt: new Date(), updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(purchaseOrders.id, id));

    await audit.log(
      {
        action: "purchase_order.approve",
        entityType: "purchase_order",
        entityId: id,
        actorId: actor.userId,
        before: { status: "pending_approval" },
        after: { status: "approved" },
      },
      tx,
    );

    return requirePurchaseOrder(tx, id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

/**
 * approved -> posted. Memotret kurs ke mata uang dasar pada tanggal PO, mengisi
 * baseAmount tiap baris + totalBase header, menerbitkan docNo. PO siap diterima (GR).
 */
export async function postPurchaseOrder(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "purchasing.purchase_orders.post");

  const run = async (tx: Tx) => {
    const current = await lockPurchaseOrder(tx, id);
    if (current.status !== "approved") {
      throw businessRule("Hanya purchase order berstatus approved yang dapat diposting.");
    }

    const lines = await loadLines(tx, id);
    if (lines.length === 0) throw businessRule("Purchase order tidak memiliki baris untuk diposting.");

    const { rate } = await resolveRateToBase(tx, current.currency, current.orderDate);

    let totalBase = add(0);
    for (const line of lines) {
      const lineBase = round(mul(line.amountForeign, rate), TOTAL_DP);
      totalBase = totalBase.plus(lineBase);
      await tx
        .update(purchaseOrderLines)
        .set({ baseAmount: toDb(lineBase, TOTAL_DP), updatedBy: actor.userId, updatedAt: new Date() })
        .where(eq(purchaseOrderLines.id, line.id));
    }

    const docNo = await nextDocumentNumber(tx, "purchase_order", { date: current.orderDate });

    await tx
      .update(purchaseOrders)
      .set({
        status: "posted",
        docNo,
        exchangeRate: rate,
        totalBase: toDb(totalBase, TOTAL_DP),
        postedAt: new Date(),
        updatedBy: actor.userId,
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, id));

    await audit.log(
      {
        action: "purchase_order.post",
        entityType: "purchase_order",
        entityId: id,
        actorId: actor.userId,
        before: { status: "approved" },
        after: { status: "posted", docNo, exchangeRate: rate, totalBase: toDb(totalBase, TOTAL_DP) },
      },
      tx,
    );

    return requirePurchaseOrder(tx, id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

/* ------------------------------------------------------------------ */
/* Pembacaan untuk mesin GR & invoice                                  */
/* ------------------------------------------------------------------ */

/** Header PO posted + baris (untuk validasi penerimaan). Melempar bila bukan posted. */
export async function requirePostedPurchaseOrder(tx: Tx, id: string) {
  const po = await requirePurchaseOrder(tx, id);
  if (po.status !== "posted") {
    throw businessRule("Penerimaan hanya dapat dilakukan terhadap PO berstatus posted.");
  }
  return po;
}

/** Sisa qty per baris PO (ordered - received). Dipakai GR-dari-PO & tes. */
export async function loadOpenPoLineQuantities(
  tx: Tx,
  poLineIds: string[],
): Promise<Map<string, { productId: string; remaining: string; unitCostBase: string }>> {
  if (poLineIds.length === 0) return new Map();
  const rows = await tx
    .select({
      id: purchaseOrderLines.id,
      productId: purchaseOrderLines.productId,
      quantity: purchaseOrderLines.quantity,
      quantityReceived: purchaseOrderLines.quantityReceived,
      baseAmount: purchaseOrderLines.baseAmount,
    })
    .from(purchaseOrderLines)
    .where(inArray(purchaseOrderLines.id, poLineIds))
    .for("update");

  const map = new Map<string, { productId: string; remaining: string; unitCostBase: string }>();
  for (const row of rows) {
    const remaining = toDb(sub(row.quantity, row.quantityReceived), QTY_DP);
    // Biaya satuan dasar per unit = baseAmount / quantity (dijaga service qty > 0).
    const unitCostBase =
      cmp(row.quantity, "0") > 0 ? toDb(div(row.baseAmount, row.quantity), 4) : "0.0000";
    map.set(row.id, { productId: row.productId, remaining, unitCostBase });
  }
  return map;
}
