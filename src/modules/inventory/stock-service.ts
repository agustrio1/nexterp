import { and, asc, eq, gt, sql } from "drizzle-orm";

import {
  products,
  stockBatches,
  stockCostLayers,
  stockLayerConsumptions,
  stockMovements,
  warehouseLocations,
  warehouses,
  type StockSourceType,
} from "@/db/schema";
import {
  postStockMovementInputSchema,
  type GetStockPositionQuery,
  type ListStockMovementsQuery,
  type PostStockMovementInput,
} from "@/modules/inventory/schemas";
import { add, cmp, dec, div, mul, round, sub, sum, toDb } from "@/lib/money";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { businessRule, forbidden, notFound, validationFailed } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "select">;

const QTY_DP = 3;
const COST_DP = 4;
const TOTAL_DP = 2;

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

/* ----------------------------- Referensi ----------------------------- */

async function assertProductActive(tx: Tx, productId: string): Promise<void> {
  const [row] = await tx
    .select({ id: products.id, isActive: products.isActive })
    .from(products)
    .where(eq(products.id, productId))
    .for("share")
    .limit(1);
  if (!row) throw validationFailed([{ path: "productId", message: "Produk tidak ditemukan." }]);
  if (!row.isActive) throw businessRule("Produk tidak aktif.");
}

async function assertWarehouseActive(tx: Tx, warehouseId: string): Promise<void> {
  const [row] = await tx
    .select({ id: warehouses.id, isActive: warehouses.isActive })
    .from(warehouses)
    .where(eq(warehouses.id, warehouseId))
    .for("share")
    .limit(1);
  if (!row) throw validationFailed([{ path: "warehouseId", message: "Gudang tidak ditemukan." }]);
  if (!row.isActive) throw businessRule("Gudang tidak aktif.");
}

async function assertLocationUsable(
  tx: Tx,
  warehouseId: string,
  locationId: string,
): Promise<void> {
  const [row] = await tx
    .select({ id: warehouseLocations.id, warehouseId: warehouseLocations.warehouseId, isActive: warehouseLocations.isActive })
    .from(warehouseLocations)
    .where(eq(warehouseLocations.id, locationId))
    .for("share")
    .limit(1);
  if (!row) throw validationFailed([{ path: "locationId", message: "Lokasi tidak ditemukan." }]);
  if (row.warehouseId !== warehouseId) throw businessRule("Lokasi bukan bagian dari gudang ini.");
  if (!row.isActive) throw businessRule("Lokasi tidak aktif.");
}

/* ------------------------------ Pergerakan ----------------------------- */

const movementReadColumns = {
  id: stockMovements.id,
  movementDate: stockMovements.movementDate,
  productId: stockMovements.productId,
  productSku: products.sku,
  productName: products.name,
  warehouseId: stockMovements.warehouseId,
  warehouseCode: warehouses.code,
  warehouseName: warehouses.name,
  locationId: stockMovements.locationId,
  locationCode: warehouseLocations.code,
  direction: stockMovements.direction,
  quantity: stockMovements.quantity,
  unitCost: stockMovements.unitCost,
  totalCost: stockMovements.totalCost,
  sourceType: stockMovements.sourceType,
  sourceId: stockMovements.sourceId,
  sourceDocNo: stockMovements.sourceDocNo,
  reverseOfId: stockMovements.reverseOfId,
  batchId: stockMovements.batchId,
  memo: stockMovements.memo,
  createdAt: stockMovements.createdAt,
};

function movementQuery(reader: Reader) {
  return reader
    .select(movementReadColumns)
    .from(stockMovements)
    .innerJoin(products, eq(products.id, stockMovements.productId))
    .innerJoin(warehouses, eq(warehouses.id, stockMovements.warehouseId))
    .leftJoin(warehouseLocations, eq(warehouseLocations.id, stockMovements.locationId));
}

async function requireMovement(reader: Reader, id: string) {
  const [row] = await movementQuery(reader).where(eq(stockMovements.id, id)).limit(1);
  if (!row) throw notFound("Pergerakan stok tidak ditemukan.");
  return row;
}

type ConsumptionPlan = {
  layerId: string;
  take: ReturnType<typeof dec>;
  newRemaining: ReturnType<typeof dec>;
  unitCost: ReturnType<typeof dec>;
};

/**
 * Mencatat satu pergerakan stok (mesin ledger + FIFO). Arah 'in' membuat lapisan
 * biaya baru; arah 'out' mengonsumsi lapisan tertua (FIFO) dan menolak stok negatif.
 * Dapat dipanggil dalam transaksi eksternal (mis. dokumen 5D atau skrip uji).
 */
export async function postStockMovement(
  actor: AuthContext,
  input: PostStockMovementInput,
  externalTx?: Tx,
) {
  assertCan(actor, "inventory.stock.manage");
  const parsed = postStockMovementInputSchema.parse(input);

  const run = async (tx: Tx) => {
    await assertProductActive(tx, parsed.productId);
    await assertWarehouseActive(tx, parsed.warehouseId);
    if (parsed.locationId != null) {
      await assertLocationUsable(tx, parsed.warehouseId, parsed.locationId);
    }

    // 5E-batch: batch yang disebut harus ada, milik produk yang sama, dan (untuk
    // keluar) belum kedaluwarsa pada tanggal pergerakan. Reversal (reverseOfId
    // terisi) DIBEBASKAN dari aturan expiry — membatalkan gerak masa lalu tidak
    // boleh gagal hanya karena batch sudah lewat tanggal kedaluwarsa.
    const isReversal = parsed.reverseOfId != null;
    let batch: { id: string; expiryDate: string | null } | null = null;
    if (parsed.batchId != null) {
      const [row] = await tx
        .select({ id: stockBatches.id, productId: stockBatches.productId, expiryDate: stockBatches.expiryDate })
        .from(stockBatches)
        .where(eq(stockBatches.id, parsed.batchId))
        .for("share")
        .limit(1);
      if (!row) throw validationFailed([{ path: "batchId", message: "Batch tidak ditemukan." }]);
      if (row.productId !== parsed.productId) {
        throw validationFailed([{ path: "batchId", message: "Batch bukan milik produk ini." }]);
      }
      batch = { id: row.id, expiryDate: row.expiryDate };
      if (
        !isReversal &&
        parsed.direction === "out" &&
        batch.expiryDate !== null &&
        batch.expiryDate < parsed.movementDate
      ) {
        throw businessRule("Batch pilihan sudah kedaluwarsa; pengeluaran ditolak.");
      }
    }

    const qty = dec(parsed.quantity);
    const common = {
      movementDate: parsed.movementDate,
      productId: parsed.productId,
      warehouseId: parsed.warehouseId,
      locationId: parsed.locationId ?? null,
      quantity: toDb(qty, QTY_DP),
      sourceType: parsed.sourceType as StockSourceType,
      sourceId: parsed.sourceId ?? null,
      sourceDocNo: parsed.sourceDocNo ?? null,
      reverseOfId: parsed.reverseOfId ?? null,
      batchId: batch?.id ?? null,
      memo: parsed.memo ?? null,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    };

    if (parsed.direction === "in") {
      const unitCost = dec(parsed.unitCost);
      const totalCost = round(mul(qty, unitCost), TOTAL_DP);

      const [created] = await tx
        .insert(stockMovements)
        .values({
          ...common,
          direction: "in",
          unitCost: toDb(unitCost, COST_DP),
          totalCost: toDb(totalCost, TOTAL_DP),
        })
        .returning({ id: stockMovements.id });
      if (!created) throw new Error("Gagal mencatat pergerakan masuk.");

      await tx.insert(stockCostLayers).values({
        productId: parsed.productId,
        warehouseId: parsed.warehouseId,
        receiptMovementId: created.id,
        movementDate: parsed.movementDate,
        batchId: batch?.id ?? null,
        expiryDate: batch?.expiryDate ?? null,
        quantityReceived: toDb(qty, QTY_DP),
        quantityRemaining: toDb(qty, QTY_DP),
        unitCost: toDb(unitCost, COST_DP),
        createdBy: actor.userId,
        updatedBy: actor.userId,
      });

      await audit.log(
        {
          action: "stock.in",
          entityType: "stock_movement",
          entityId: created.id,
          actorId: actor.userId,
          after: {
            productId: parsed.productId,
            warehouseId: parsed.warehouseId,
            quantity: common.quantity,
            unitCost: toDb(unitCost, COST_DP),
            sourceType: parsed.sourceType,
          },
        },
        tx,
      );
      return requireMovement(tx, created.id);
    }

    // ---- Arah 'out': kunci lapisan terlama, konsumsi, tolak stok negatif ----
    // Urutan FEFO lalu FIFO (keputusan 5E-batch): batch ber-expiry paling dulu
    // (NULLS LAST), batch expired DILEWATI (bukan dikonsumsi), lalu tanggal,
    // lalu id. Bila batchId eksplisit, antrian dibatasi ke batch itu saja.
    const layers = await tx
      .select({
        id: stockCostLayers.id,
        quantityRemaining: stockCostLayers.quantityRemaining,
        unitCost: stockCostLayers.unitCost,
      })
      .from(stockCostLayers)
      .where(
        and(
          eq(stockCostLayers.productId, parsed.productId),
          eq(stockCostLayers.warehouseId, parsed.warehouseId),
          gt(stockCostLayers.quantityRemaining, "0"),
          batch === null ? undefined : eq(stockCostLayers.batchId, batch.id),
          isReversal
            ? undefined
            : sql`(${stockCostLayers.expiryDate} is null or ${stockCostLayers.expiryDate} >= ${parsed.movementDate})`,
        ),
      )
      .orderBy(
        sql`${stockCostLayers.expiryDate} asc nulls last`,
        asc(stockCostLayers.movementDate),
        asc(stockCostLayers.id),
      )
      .for("update");

    const available = sum(layers.map((l) => l.quantityRemaining));
    if (cmp(available, qty) < 0) {
      throw businessRule("Stok tidak mencukupi; stok negatif ditolak.");
    }

    const plan: ConsumptionPlan[] = [];
    let need = qty;
    for (const layer of layers) {
      if (cmp(need, 0) <= 0) break;
      const remaining = dec(layer.quantityRemaining);
      const take = cmp(remaining, need) >= 0 ? need : remaining;
      plan.push({
        layerId: layer.id,
        take,
        newRemaining: sub(remaining, take),
        unitCost: dec(layer.unitCost),
      });
      need = sub(need, take);
    }

    const weightedCost = add(...plan.map((p) => mul(p.take, p.unitCost)));
    const blendedUnitCost = round(div(weightedCost, qty), COST_DP);
    const totalCost = round(weightedCost, TOTAL_DP);

    const [created] = await tx
      .insert(stockMovements)
      .values({
        ...common,
        direction: "out",
        unitCost: toDb(blendedUnitCost, COST_DP),
        totalCost: toDb(totalCost, TOTAL_DP),
      })
      .returning({ id: stockMovements.id });
    if (!created) throw new Error("Gagal mencatat pergerakan keluar.");

    for (const p of plan) {
      await tx
        .update(stockCostLayers)
        .set({
          quantityRemaining: toDb(p.newRemaining, QTY_DP),
          updatedBy: actor.userId,
          updatedAt: new Date(),
        })
        .where(eq(stockCostLayers.id, p.layerId));

      await tx.insert(stockLayerConsumptions).values({
        issueMovementId: created.id,
        layerId: p.layerId,
        quantity: toDb(p.take, QTY_DP),
        unitCost: toDb(p.unitCost, COST_DP),
        createdBy: actor.userId,
        updatedBy: actor.userId,
      });
    }

    await audit.log(
      {
        action: "stock.out",
        entityType: "stock_movement",
        entityId: created.id,
        actorId: actor.userId,
        after: {
          productId: parsed.productId,
          warehouseId: parsed.warehouseId,
          quantity: common.quantity,
          blendedUnitCost: toDb(blendedUnitCost, COST_DP),
          totalCost: toDb(totalCost, TOTAL_DP),
          consumedLayers: plan.map((p) => ({ layerId: p.layerId, quantity: toDb(p.take, QTY_DP) })),
        },
      },
      tx,
    );
    return requireMovement(tx, created.id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

/* ------------------------------- Baca -------------------------------- */

export async function getStockPosition(
  actor: AuthContext,
  query: GetStockPositionQuery = {},
  externalTx?: Tx,
) {
  assertCan(actor, "inventory.stock.read");
  const reader = externalTx ?? db;
  const conditions = [
    query.productId === undefined ? undefined : eq(stockMovements.productId, query.productId),
    query.warehouseId === undefined ? undefined : eq(stockMovements.warehouseId, query.warehouseId),
  ];

  const onHandRows = await reader
    .select({
      productId: stockMovements.productId,
      warehouseId: stockMovements.warehouseId,
      productSku: products.sku,
      productName: products.name,
      warehouseCode: warehouses.code,
      warehouseName: warehouses.name,
      onHand:
        sql<string>`coalesce(sum(case when ${stockMovements.direction} = 'in' then ${stockMovements.quantity} else -${stockMovements.quantity} end), 0)::numeric(18,3)`,
      movementCount: sql<number>`count(*)::int`,
    })
    .from(stockMovements)
    .innerJoin(products, eq(products.id, stockMovements.productId))
    .innerJoin(warehouses, eq(warehouses.id, stockMovements.warehouseId))
    .where(and(...conditions))
    .groupBy(
      stockMovements.productId,
      stockMovements.warehouseId,
      products.id,
      warehouses.id,
    )
    .orderBy(asc(products.sku), asc(warehouses.code));

  const layerConditions = [
    query.productId === undefined ? undefined : eq(stockCostLayers.productId, query.productId),
    query.warehouseId === undefined ? undefined : eq(stockCostLayers.warehouseId, query.warehouseId),
  ];
  const layerRows = await reader
    .select({
      productId: stockCostLayers.productId,
      warehouseId: stockCostLayers.warehouseId,
      remaining: sql<string>`coalesce(sum(${stockCostLayers.quantityRemaining}), 0)::numeric(18,3)`,
      value:
        sql<string>`coalesce(sum(${stockCostLayers.quantityRemaining} * ${stockCostLayers.unitCost}), 0)::numeric(18,2)`,
    })
    .from(stockCostLayers)
    .where(and(...layerConditions))
    .groupBy(stockCostLayers.productId, stockCostLayers.warehouseId);

  const layerByKey = new Map(
    layerRows.map((l) => [`${l.productId}:${l.warehouseId}`, l]),
  );

  return onHandRows.map((row) => {
    const layer = layerByKey.get(`${row.productId}:${row.warehouseId}`);
    return {
      productId: row.productId,
      productSku: row.productSku,
      productName: row.productName,
      warehouseId: row.warehouseId,
      warehouseCode: row.warehouseCode,
      warehouseName: row.warehouseName,
      onHand: row.onHand,
      layerRemaining: layer?.remaining ?? "0.000",
      valuation: layer?.value ?? "0.00",
      movementCount: row.movementCount,
    };
  });
}

export async function listStockMovements(
  actor: AuthContext,
  query: ListStockMovementsQuery = {},
  externalTx?: Tx,
) {
  assertCan(actor, "inventory.stock.read");
  const reader = externalTx ?? db;
  const conditions = [
    query.productId === undefined ? undefined : eq(stockMovements.productId, query.productId),
    query.warehouseId === undefined ? undefined : eq(stockMovements.warehouseId, query.warehouseId),
  ];
  return movementQuery(reader)
    .where(and(...conditions))
    .orderBy(asc(stockMovements.movementDate), asc(stockMovements.id));
}
