import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";

import { salesDeliveryLines, salesReturnLines, salesReturns, stockMovements } from "@/db/schema";
import type { CreateSalesReturnInput, ListSalesQuery } from "@/modules/sales/schemas";
import { assertBranchWarehouse, assertCan } from "@/modules/sales/_refs";
import { requirePostedDelivery } from "@/modules/sales/delivery-service";
import { resolveArAccountIds } from "@/modules/sales/ar-account-config";
import { postStockMovement } from "@/modules/inventory/stock-service";
import { createSystemDraft, postJournal, reverseJournal } from "@/modules/accounting/journal-service";
import { cmp, mul, round, sum, toDb } from "@/lib/money";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { businessRule, notFound, validationFailed } from "@/server/errors";
import { nextDocumentNumber } from "@/server/numbering";
import type { AuthContext } from "@/server/authz";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Tx | typeof db;

/** sourceType jurnal COGS untuk retur penjualan (Dr Inventory / Cr COGS). */
const SOURCE_RETURN = "sales_return";
const QTY_DP = 3;
const COST_DP = 4;
const TOTAL_DP = 2;

const srtColumns = {
  id: salesReturns.id,
  docNo: salesReturns.docNo,
  status: salesReturns.status,
  deliveryId: salesReturns.deliveryId,
  customerId: salesReturns.customerId,
  branchId: salesReturns.branchId,
  warehouseId: salesReturns.warehouseId,
  returnDate: salesReturns.returnDate,
  notes: salesReturns.notes,
  journalEntryId: salesReturns.journalEntryId,
  postedAt: salesReturns.postedAt,
  cancelledAt: salesReturns.cancelledAt,
  reversedAt: salesReturns.reversedAt,
  reason: salesReturns.reason,
  createdAt: salesReturns.createdAt,
  updatedAt: salesReturns.updatedAt,
};

async function loadLines(reader: Reader, returnId: string) {
  return reader
    .select({
      id: salesReturnLines.id,
      returnId: salesReturnLines.returnId,
      lineNo: salesReturnLines.lineNo,
      deliveryLineId: salesReturnLines.deliveryLineId,
      productId: salesReturnLines.productId,
      description: salesReturnLines.description,
      quantity: salesReturnLines.quantity,
      unitCost: salesReturnLines.unitCost,
      cogsAmount: salesReturnLines.cogsAmount,
    })
    .from(salesReturnLines)
    .where(eq(salesReturnLines.returnId, returnId))
    .orderBy(asc(salesReturnLines.lineNo));
}

async function requireReturn(reader: Reader, id: string) {
  const [header] = await reader.select(srtColumns).from(salesReturns).where(eq(salesReturns.id, id)).limit(1);
  if (!header) throw notFound("Retur penjualan tidak ditemukan.");
  const lines = await loadLines(reader, id);
  return { ...header, lines };
}

async function lockReturn(tx: Tx, id: string) {
  const [row] = await tx.select(srtColumns).from(salesReturns).where(eq(salesReturns.id, id)).for("update").limit(1);
  if (!row) throw notFound("Retur penjualan tidak ditemukan.");
  return row;
}

/* ----------------------------- Baca ------------------------------ */

export async function listReturns(actor: AuthContext, query: ListSalesQuery = {}, externalTx?: Tx) {
  assertCan(actor, "sales.returns.read");
  const reader = externalTx ?? db;
  const conditions: (SQL | undefined)[] = [
    query.status === undefined ? undefined : eq(salesReturns.status, query.status as "draft"),
    query.customerId === undefined ? undefined : eq(salesReturns.customerId, query.customerId),
    query.branchId === undefined ? undefined : eq(salesReturns.branchId, query.branchId),
  ];
  return reader.select(srtColumns).from(salesReturns).where(and(...conditions)).orderBy(desc(salesReturns.returnDate));
}

export async function getReturn(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "sales.returns.read");
  return requireReturn(externalTx ?? db, id);
}

/* ----------------------------- Tulis: draf ----------------------------- */

/** Buat retur draf dari pengiriman posted. Jumlah retur tidak melebihi jumlah kirim (dikurangi retur aktif lain). */
export async function createReturn(actor: AuthContext, input: CreateSalesReturnInput, externalTx?: Tx) {
  assertCan(actor, "sales.returns.manage");
  const run = async (tx: Tx) => {
    const delivery = await requirePostedDelivery(tx, input.deliveryId);
    if (delivery.branchId !== input.branchId) throw validationFailed([{ path: "branchId", message: "Cabang retur harus sama dengan cabang pengiriman." }]);
    await assertBranchWarehouse(tx, input.warehouseId, delivery.branchId);

    const dlvLineIds = [...new Set(input.lines.map((l) => l.deliveryLineId))];
    const dlvLines = await tx
      .select({ id: salesDeliveryLines.id, deliveryId: salesDeliveryLines.deliveryId, productId: salesDeliveryLines.productId, quantity: salesDeliveryLines.quantity })
      .from(salesDeliveryLines)
      .where(inArray(salesDeliveryLines.id, dlvLineIds));
    const dlvById = new Map(dlvLines.map((l) => [l.id, l]));

    const returnedAlready = await getReturnedQtyByDeliveryLine(tx, dlvLineIds);

    const requestedByDlvLine = new Map<string, string>();
    for (const [index, line] of input.lines.entries()) {
      const path = `lines.${index}`;
      const dlv = dlvById.get(line.deliveryLineId);
      if (!dlv || dlv.deliveryId !== input.deliveryId) throw validationFailed([{ path: `${path}.deliveryLineId`, message: "Baris pengiriman tidak ditemukan atau bukan milik pengiriman ini." }]);
      if (line.productId !== dlv.productId) throw validationFailed([{ path: `${path}.productId`, message: "Produk tidak cocok dengan baris pengiriman." }]);
      const alreadyReturned = returnedAlready.get(line.deliveryLineId) ?? "0.000";
      const newAcc = toDb(sum([requestedByDlvLine.get(line.deliveryLineId) ?? "0.000", line.quantity]), QTY_DP);
      const totalReturned = toDb(sum([alreadyReturned, newAcc]), QTY_DP);
      if (cmp(totalReturned, dlv.quantity) > 0) {
        throw businessRule(`Total retur (${totalReturned}) melebihi jumlah kirim (${dlv.quantity}) pada baris ${index + 1}.`);
      }
      requestedByDlvLine.set(line.deliveryLineId, newAcc);
    }

    const [header] = await tx.insert(salesReturns).values({
      status: "draft",
      deliveryId: input.deliveryId,
      customerId: delivery.customerId,
      branchId: delivery.branchId,
      warehouseId: input.warehouseId,
      returnDate: input.returnDate,
      notes: input.notes ?? null,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    }).returning({ id: salesReturns.id });

    await tx.insert(salesReturnLines).values(
      input.lines.map((line, index) => ({
        returnId: header!.id,
        lineNo: index + 1,
        deliveryLineId: line.deliveryLineId,
        productId: line.productId,
        description: null,
        quantity: toDb(line.quantity, QTY_DP),
        unitCost: null,
        cogsAmount: null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })),
    );

    await audit.log({ action: "sales.return.create", entityType: "sales_return", entityId: header!.id, actorId: actor.userId, after: { deliveryId: input.deliveryId, lineCount: input.lines.length } }, tx);
    return requireReturn(tx, header!.id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

/* -------------------------- Transisi: post ------------------------- */

/**
 * draft -> posted. Terima kembali stok per baris (goods_receipt) menilai dengan
 * biaya satuan asal keluar (unitCost baris pengiriman). Terbitkan jurnal
 * Dr Inventory / Cr COGS senilai total biaya retur.
 */
export async function postReturn(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "sales.returns.manage");
  const run = async (tx: Tx) => {
    const current = await lockReturn(tx, id);
    if (current.status !== "draft") throw businessRule("Hanya retur berstatus draft yang dapat diposting.");

    const delivery = await requirePostedDelivery(tx, current.deliveryId);
    await assertBranchWarehouse(tx, current.warehouseId, delivery.branchId);

    const lines = await loadLines(tx, id);
    if (lines.length === 0) throw businessRule("Retur tidak memiliki baris untuk diposting.");

    // Biaya satuan asal = unitCost baris pengiriman (biaya saat keluar via FIFO).
    const dlvLineIds = [...new Set(lines.map((l) => l.deliveryLineId))];
    const dlvLines = await tx
      .select({ id: salesDeliveryLines.id, unitCost: salesDeliveryLines.unitCost, quantity: salesDeliveryLines.quantity })
      .from(salesDeliveryLines)
      .where(inArray(salesDeliveryLines.id, dlvLineIds));
    const dlvById = new Map(dlvLines.map((l) => [l.id, l]));

    const returnedAlready = await getReturnedQtyByDeliveryLine(tx, dlvLineIds, id);
    const docNo = await nextDocumentNumber(tx, "sales_return", { date: current.returnDate });

    const cogsAmounts: string[] = [];
    for (const line of lines) {
      const alreadyReturned = returnedAlready.get(line.deliveryLineId) ?? "0.000";
      const projected = toDb(sum([alreadyReturned, line.quantity]), QTY_DP);
      const dlv = dlvById.get(line.deliveryLineId);
      if (!dlv) throw businessRule("Baris pengiriman retur tidak ditemukan.");
      if (cmp(projected, dlv.quantity) > 0) throw businessRule(`Total retur (${projected}) melebihi jumlah kirim (${dlv.quantity}).`);

      const unitCost = dlv.unitCost ?? "0";
      const mv = await postStockMovement(
        actor,
        {
          productId: line.productId,
          warehouseId: current.warehouseId,
          direction: "in",
          quantity: line.quantity,
          unitCost,
          movementDate: current.returnDate,
          sourceType: "goods_receipt",
          sourceId: current.id,
          sourceDocNo: docNo,
        },
        tx,
      );
      const cogs = mv.totalCost ?? toDb(round(mul(line.quantity, unitCost), TOTAL_DP), TOTAL_DP);
      await tx.update(salesReturnLines).set({ unitCost: toDb(unitCost, COST_DP), cogsAmount: toDb(cogs, TOTAL_DP), updatedBy: actor.userId, updatedAt: new Date() }).where(eq(salesReturnLines.id, line.id));
      cogsAmounts.push(toDb(cogs, TOTAL_DP));
    }

    const totalCogs = toDb(sum(cogsAmounts), TOTAL_DP);
    let journalEntryId: string | null = null;
    if (cmp(totalCogs, "0") > 0) {
      const { cogsAccountId, inventoryAccountId } = await resolveArAccountIds(tx);
      const draft = await createSystemDraft(tx, actor, {
        entryDate: current.returnDate,
        description: `Retur penjualan ${docNo} (Inventory)`,
        reference: delivery.docNo ?? undefined,
        lines: [
          { accountId: inventoryAccountId, side: "debit", amount: totalCogs },
          { accountId: cogsAccountId, side: "credit", amount: totalCogs },
        ],
        sourceType: SOURCE_RETURN,
        sourceId: current.id,
        sourceEvent: "post",
      });
      const posted = await postJournal(actor, draft.id, tx);
      journalEntryId = posted.id;
    }

    await tx.update(salesReturns).set({ status: "posted", docNo, journalEntryId, postedAt: new Date(), updatedBy: actor.userId, updatedAt: new Date() }).where(eq(salesReturns.id, id));
    await audit.log({ action: "sales.return.post", entityType: "sales_return", entityId: id, actorId: actor.userId, after: { status: "posted", docNo, totalCogs, journalEntryId } }, tx);
    return requireReturn(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

/* -------------------------- Transisi: cancel ----------------------- */

export async function cancelReturn(actor: AuthContext, id: string, reason: string, externalTx?: Tx) {
  assertCan(actor, "sales.returns.manage");
  const run = async (tx: Tx) => {
    const current = await lockReturn(tx, id);
    if (current.status !== "draft") throw businessRule("Hanya retur berstatus draft yang dapat dibatalkan. Gunakan reversal untuk retur posted.");
    await tx.update(salesReturns).set({ status: "cancelled", reason, cancelledAt: new Date(), updatedBy: actor.userId, updatedAt: new Date() }).where(eq(salesReturns.id, id));
    await audit.log({ action: "sales.return.cancel", entityType: "sales_return", entityId: id, actorId: actor.userId, after: { status: "cancelled", reason } }, tx);
    return requireReturn(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

/* -------------------------- Transisi: reverse ---------------------- */

/** posted -> reversed: keluarkan kembali stok (penyeimbang gerak masuk) + balik jurnal. */
export async function reverseReturn(actor: AuthContext, id: string, reason: string, externalTx?: Tx) {
  assertCan(actor, "sales.returns.manage");
  const run = async (tx: Tx) => {
    const current = await lockReturn(tx, id);
    if (current.status !== "posted") throw businessRule("Hanya retur berstatus posted yang dapat dibalik.");
    if (!current.docNo) throw businessRule("Retur posted tanpa nomor; tidak dapat dibalik.");

    const movements = await tx
      .select({ id: stockMovements.id, productId: stockMovements.productId, quantity: stockMovements.quantity, unitCost: stockMovements.unitCost })
      .from(stockMovements)
      .where(and(eq(stockMovements.sourceId, current.id), isNull(stockMovements.reverseOfId)))
      .orderBy(stockMovements.id);

    for (const m of movements) {
      await postStockMovement(
        actor,
        {
          productId: m.productId,
          warehouseId: current.warehouseId,
          direction: "out",
          quantity: m.quantity,
          movementDate: current.returnDate,
          sourceType: "goods_issue",
          sourceId: current.id,
          sourceDocNo: current.docNo,
          reverseOfId: m.id,
        },
        tx,
      );
    }

    if (current.journalEntryId) await reverseJournal(actor, current.journalEntryId, { reason }, tx);

    await tx.update(salesReturns).set({ status: "reversed", reason, reversedAt: new Date(), updatedBy: actor.userId, updatedAt: new Date() }).where(eq(salesReturns.id, id));
    await audit.log({ action: "sales.return.reverse", entityType: "sales_return", entityId: id, actorId: actor.userId, after: { status: "reversed", reason } }, tx);
    return requireReturn(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

/* ----------------------------- Guard ------------------------------- */

/** Total qty sudah diretur per delivery line pada retur aktif (draft/posted). */
async function getReturnedQtyByDeliveryLine(tx: Tx, deliveryLineIds: string[], excludeId?: string): Promise<Map<string, string>> {
  if (deliveryLineIds.length === 0) return new Map();
  const conditions = [
    inArray(salesReturnLines.deliveryLineId, deliveryLineIds),
    sql`${salesReturns.status} in ('draft', 'posted')`,
  ];
  if (excludeId) conditions.push(sql`${salesReturns.id} <> ${excludeId}`);
  const rows = await tx
    .select({
      deliveryLineId: salesReturnLines.deliveryLineId,
      qty: sql<string>`coalesce(sum(${salesReturnLines.quantity}), 0)::numeric(18,3)`,
    })
    .from(salesReturnLines)
    .innerJoin(salesReturns, eq(salesReturns.id, salesReturnLines.returnId))
    .where(and(...conditions))
    .groupBy(salesReturnLines.deliveryLineId);
  return new Map(rows.map((r) => [r.deliveryLineId, toDb(r.qty, QTY_DP)]));
}
