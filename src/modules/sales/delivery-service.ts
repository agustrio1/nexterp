import { and, asc, desc, eq, isNull, sql, type SQL } from "drizzle-orm";

import { customerInvoices, salesDeliveryLines, salesDeliveries, salesOrderLines, stockMovements } from "@/db/schema";
import type { CreateDeliveryInput, ListSalesQuery } from "@/modules/sales/schemas";
import { assertBranchWarehouse, assertCan } from "@/modules/sales/_refs";
import { loadOpenSoLineQuantities, requirePostedSo } from "@/modules/sales/so-service";
import { postStockMovement } from "@/modules/inventory/stock-service";
import { resolveArAccountIds } from "@/modules/sales/ar-account-config";
import { createSystemDraft, postJournal, reverseJournal } from "@/modules/accounting/journal-service";
import { add, cmp, mul, round, sum, toDb } from "@/lib/money";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { businessRule, notFound, validationFailed } from "@/server/errors";
import { nextDocumentNumber } from "@/server/numbering";
import type { AuthContext } from "@/server/authz";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Tx | typeof db;

/** sourceType jurnal COGS perpetual untuk pengiriman (Dr COGS / Cr Inventory). */
const SOURCE_DELIVERY = "sales_delivery";
const QTY_DP = 3;
const COST_DP = 4;
const TOTAL_DP = 2;

const dlvColumns = {
  id: salesDeliveries.id,
  docNo: salesDeliveries.docNo,
  status: salesDeliveries.status,
  soId: salesDeliveries.soId,
  customerId: salesDeliveries.customerId,
  branchId: salesDeliveries.branchId,
  warehouseId: salesDeliveries.warehouseId,
  deliveryDate: salesDeliveries.deliveryDate,
  notes: salesDeliveries.notes,
  journalEntryId: salesDeliveries.journalEntryId,
  postedAt: salesDeliveries.postedAt,
  cancelledAt: salesDeliveries.cancelledAt,
  reversedAt: salesDeliveries.reversedAt,
  reason: salesDeliveries.reason,
  createdAt: salesDeliveries.createdAt,
  updatedAt: salesDeliveries.updatedAt,
};

async function loadLines(reader: Reader, deliveryId: string) {
  return reader
    .select({
      id: salesDeliveryLines.id,
      deliveryId: salesDeliveryLines.deliveryId,
      lineNo: salesDeliveryLines.lineNo,
      soLineId: salesDeliveryLines.soLineId,
      productId: salesDeliveryLines.productId,
      description: salesDeliveryLines.description,
      quantity: salesDeliveryLines.quantity,
      unitCost: salesDeliveryLines.unitCost,
      cogsAmount: salesDeliveryLines.cogsAmount,
    })
    .from(salesDeliveryLines)
    .where(eq(salesDeliveryLines.deliveryId, deliveryId))
    .orderBy(asc(salesDeliveryLines.lineNo));
}

async function requireDelivery(reader: Reader, id: string) {
  const [header] = await reader.select(dlvColumns).from(salesDeliveries).where(eq(salesDeliveries.id, id)).limit(1);
  if (!header) throw notFound("Pengiriman tidak ditemukan.");
  const lines = await loadLines(reader, id);
  return { ...header, lines };
}

async function lockDelivery(tx: Tx, id: string) {
  const [row] = await tx.select(dlvColumns).from(salesDeliveries).where(eq(salesDeliveries.id, id)).for("update").limit(1);
  if (!row) throw notFound("Pengiriman tidak ditemukan.");
  return row;
}

/* ----------------------------- Baca ------------------------------ */

export async function listDeliveries(actor: AuthContext, query: ListSalesQuery = {}, externalTx?: Tx) {
  assertCan(actor, "sales.deliveries.read");
  const reader = externalTx ?? db;
  const conditions: (SQL | undefined)[] = [
    query.status === undefined ? undefined : eq(salesDeliveries.status, query.status as "draft"),
    query.customerId === undefined ? undefined : eq(salesDeliveries.customerId, query.customerId),
    query.branchId === undefined ? undefined : eq(salesDeliveries.branchId, query.branchId),
  ];
  return reader.select(dlvColumns).from(salesDeliveries).where(and(...conditions)).orderBy(desc(salesDeliveries.deliveryDate));
}

export async function getDelivery(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "sales.deliveries.read");
  return requireDelivery(externalTx ?? db, id);
}

/* ----------------------------- Tulis: draf ----------------------------- */

export async function createDelivery(actor: AuthContext, input: CreateDeliveryInput, externalTx?: Tx) {
  assertCan(actor, "sales.deliveries.manage");
  const run = async (tx: Tx) => {
    const so = await requirePostedSo(tx, input.soId);
    if (so.branchId !== input.branchId) throw validationFailed([{ path: "branchId", message: "Cabang pengiriman harus sama dengan cabang SO." }]);
    await assertBranchWarehouse(tx, input.warehouseId, so.branchId);

    // Sisa qty per baris SO (FOR UPDATE pada baris agar serialisasi pengiriman).
    const soLineIds = input.lines.map((l) => l.soLineId);
    const remaining = await loadOpenSoLineQuantities(tx, soLineIds);

    // Akumulasi qty per baris SO (satu SO line bisa dipecah ke beberapa baris kirim).
    const requestedBySoLine = new Map<string, string>();
    for (const [index, line] of input.lines.entries()) {
      const path = `lines.${index}`;
      const info = remaining.get(line.soLineId);
      if (!info) throw validationFailed([{ path: `${path}.soLineId`, message: "Baris SO tidak ditemukan atau bukan milik SO ini." }]);
      if (line.productId !== info.productId) throw validationFailed([{ path: `${path}.productId`, message: "Produk tidak cocok dengan baris SO." }]);
      const acc = add(requestedBySoLine.get(line.soLineId) ?? "0", line.quantity).toFixed(QTY_DP);
      if (cmp(acc, info.remaining) > 0) {
        throw businessRule(`Total kirim ke baris SO (${acc}) melebihi sisa pesanan (${info.remaining}).`);
      }
      requestedBySoLine.set(line.soLineId, acc);
    }

    const [header] = await tx.insert(salesDeliveries).values({
      status: "draft",
      soId: input.soId,
      customerId: so.customerId,
      branchId: so.branchId,
      warehouseId: input.warehouseId,
      deliveryDate: input.deliveryDate,
      notes: input.notes ?? null,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    }).returning({ id: salesDeliveries.id });

    await tx.insert(salesDeliveryLines).values(
      input.lines.map((line, index) => ({
        deliveryId: header!.id,
        lineNo: index + 1,
        soLineId: line.soLineId,
        productId: line.productId,
        description: null,
        quantity: toDb(line.quantity, QTY_DP),
        unitCost: null,
        cogsAmount: null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })),
    );

    await audit.log({ action: "sales.delivery.create", entityType: "sales_delivery", entityId: header!.id, actorId: actor.userId, after: { soId: input.soId, lineCount: input.lines.length } }, tx);
    return requireDelivery(tx, header!.id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

/* -------------------------- Transisi: post ------------------------- */

/**
 * draft -> posted. Terbitkan nomor, keluarkan stok per baris lewat mesin FIFO
 * (sumber goods_issue, sourceId=id pengiriman) lalu tangkap biaya (unitCost &
 * totalCost) ke baris. Terbitkan jurnal Dr COGS / Cr Inventory senilai total
 * biaya, tautkan journalEntryId, lalu naikkan quantityDelivered baris SO.
 */
export async function postDelivery(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "sales.deliveries.manage");
  const run = async (tx: Tx) => {
    const current = await lockDelivery(tx, id);
    if (current.status !== "draft") throw businessRule("Hanya pengiriman berstatus draft yang dapat diposting.");

    const so = await requirePostedSo(tx, current.soId);
    await assertBranchWarehouse(tx, current.warehouseId, so.branchId);

    const lines = await loadLines(tx, id);
    if (lines.length === 0) throw businessRule("Pengiriman tidak memiliki baris untuk diposting.");

    const remaining = await loadOpenSoLineQuantities(tx, lines.map((l) => l.soLineId));
    const docNo = await nextDocumentNumber(tx, "sales_delivery", { date: current.deliveryDate });

    const cogsAmounts: string[] = [];
    for (const line of lines) {
      const info = remaining.get(line.soLineId);
      if (!info) throw businessRule("Baris SO pengiriman tidak lagi tersedia.");
      if (cmp(line.quantity, info.remaining) > 0) {
        throw businessRule(`Jumlah kirim (${line.quantity}) melebihi sisa pesanan (${info.remaining}).`);
      }
      const mv = await postStockMovement(
        actor,
        {
          productId: line.productId,
          warehouseId: current.warehouseId,
          direction: "out",
          quantity: line.quantity,
          movementDate: current.deliveryDate,
          sourceType: "goods_issue",
          sourceId: current.id,
          sourceDocNo: docNo,
        },
        tx,
      );
      const unitCost = mv.unitCost ?? "0";
      const cogs = mv.totalCost ?? toDb(round(mul(line.quantity, unitCost), TOTAL_DP), TOTAL_DP);
      await tx.update(salesDeliveryLines).set({ unitCost: toDb(unitCost, COST_DP), cogsAmount: toDb(cogs, TOTAL_DP), updatedBy: actor.userId, updatedAt: new Date() }).where(eq(salesDeliveryLines.id, line.id));
      cogsAmounts.push(toDb(cogs, TOTAL_DP));

      // Naikkan quantityDelivered baris SO (akurat lewat aritmetika numeric DB).
      await tx.update(salesOrderLines).set({
        quantityDelivered: sql`${salesOrderLines.quantityDelivered} + ${toDb(line.quantity, QTY_DP)}`,
        updatedBy: actor.userId,
        updatedAt: new Date(),
      }).where(eq(salesOrderLines.id, line.soLineId));
    }

    const totalCogs = toDb(sum(cogsAmounts), TOTAL_DP);
    let journalEntryId: string | null = null;
    if (cmp(totalCogs, "0") > 0) {
      const { cogsAccountId, inventoryAccountId } = await resolveArAccountIds(tx);
      const draft = await createSystemDraft(tx, actor, {
        entryDate: current.deliveryDate,
        description: `Pengiriman barang ${docNo} (COGS)`,
        reference: so.docNo ?? undefined,
        lines: [
          { accountId: cogsAccountId, side: "debit", amount: totalCogs },
          { accountId: inventoryAccountId, side: "credit", amount: totalCogs },
        ],
        sourceType: SOURCE_DELIVERY,
        sourceId: current.id,
        sourceEvent: "post",
      });
      const posted = await postJournal(actor, draft.id, tx);
      journalEntryId = posted.id;
    }

    await tx.update(salesDeliveries).set({
      status: "posted", docNo, journalEntryId, postedAt: new Date(), updatedBy: actor.userId, updatedAt: new Date(),
    }).where(eq(salesDeliveries.id, id));

    await audit.log({ action: "sales.delivery.post", entityType: "sales_delivery", entityId: id, actorId: actor.userId, after: { status: "posted", docNo, totalCogs, journalEntryId } }, tx);
    return requireDelivery(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

/* -------------------------- Transisi: cancel ----------------------- */

export async function cancelDelivery(actor: AuthContext, id: string, reason: string, externalTx?: Tx) {
  assertCan(actor, "sales.deliveries.manage");
  const run = async (tx: Tx) => {
    const current = await lockDelivery(tx, id);
    if (current.status !== "draft") throw businessRule("Hanya pengiriman berstatus draft yang dapat dibatalkan. Gunakan reversal untuk pengiriman posted.");
    await tx.update(salesDeliveries).set({ status: "cancelled", reason, cancelledAt: new Date(), updatedBy: actor.userId, updatedAt: new Date() }).where(eq(salesDeliveries.id, id));
    await audit.log({ action: "sales.delivery.cancel", entityType: "sales_delivery", entityId: id, actorId: actor.userId, after: { status: "cancelled", reason } }, tx);
    return requireDelivery(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

/* -------------------------- Transisi: reverse ---------------------- */

/**
 * posted -> reversed. Kembalikan stok lewat pergerakan masuk penyeimbang
 * (reverseOfId menunjuk gerak asal), turunkan quantityDelivered SO, balik jurnal
 * COGS. Tidak dapat dibalik bila sudah ditagih invoice posted.
 */
export async function reverseDelivery(actor: AuthContext, id: string, reason: string, externalTx?: Tx) {
  assertCan(actor, "sales.deliveries.manage");
  const run = async (tx: Tx) => {
    const current = await lockDelivery(tx, id);
    if (current.status !== "posted") throw businessRule("Hanya pengiriman berstatus posted yang dapat dibalik.");
    if (!current.docNo) throw businessRule("Pengiriman posted tanpa nomor; tidak dapat dibalik.");

    // Tolak reversal bila pengiriman sudah ditagih invoice posted (menjaga rantai AR).
    const [invoiced] = await tx
      .select({ id: customerInvoices.id })
      .from(customerInvoices)
      .where(and(eq(customerInvoices.deliveryId, current.id), eq(customerInvoices.status, "posted")))
      .limit(1);
    if (invoiced) throw businessRule("Pengiriman sudah ditagih faktur berstatus posted; batalkan faktur lebih dulu.");

    const movements = await tx
      .select({
        id: stockMovements.id,
        productId: stockMovements.productId,
        quantity: stockMovements.quantity,
        unitCost: stockMovements.unitCost,
      })
      .from(stockMovements)
      .where(and(eq(stockMovements.sourceId, current.id), isNull(stockMovements.reverseOfId)))
      .orderBy(stockMovements.id);

    const lines = await loadLines(tx, id);

    for (const m of movements) {
      await postStockMovement(
        actor,
        {
          productId: m.productId,
          warehouseId: current.warehouseId,
          direction: "in",
          quantity: m.quantity,
          unitCost: m.unitCost ?? "0",
          movementDate: current.deliveryDate,
          sourceType: "goods_receipt",
          sourceId: current.id,
          sourceDocNo: current.docNo,
          reverseOfId: m.id,
        },
        tx,
      );
      const owner = lines.find((l) => l.productId === m.productId);
      if (owner) {
        await tx.update(salesOrderLines).set({
          quantityDelivered: sql`GREATEST(${salesOrderLines.quantityDelivered} - ${toDb(m.quantity, QTY_DP)}, 0)`,
          updatedBy: actor.userId,
          updatedAt: new Date(),
        }).where(eq(salesOrderLines.id, owner.soLineId));
      }
    }

    if (current.journalEntryId) {
      await reverseJournal(actor, current.journalEntryId, { reason }, tx);
    }

    await tx.update(salesDeliveries).set({ status: "reversed", reason, reversedAt: new Date(), updatedBy: actor.userId, updatedAt: new Date() }).where(eq(salesDeliveries.id, id));
    await audit.log({ action: "sales.delivery.reverse", entityType: "sales_delivery", entityId: id, actorId: actor.userId, after: { status: "reversed", reason } }, tx);
    return requireDelivery(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

/** Pembaca pengiriman posted (dipakai invoice). */
export async function requirePostedDelivery(tx: Tx, id: string) {
  const dlv = await requireDelivery(tx, id);
  if (dlv.status !== "posted") throw businessRule("Faktur hanya dapat dibuat dari pengiriman berstatus posted.");
  return dlv;
}
