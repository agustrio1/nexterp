import { and, asc, eq, gte, isNotNull, lt, lte, sql } from "drizzle-orm";

import {
  products,
  stockCostLayers,
  stockMovements,
  warehouses,
} from "@/db/schema";
import type {
  ExpiryScheduleQuery,
  InventoryValuationQuery,
  ReorderQuery,
  StockCardQuery,
} from "@/modules/inventory/report-schemas";
import { cmp, dec, toDb } from "@/lib/money";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { forbidden, notFound } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Tx | typeof db;

const QTY_DP = 3;
const COST_DP = 4;
const TOTAL_DP = 2;

/**
 * Laporan persediaan (Tahap 5H), read-only. Sumber: `stock_movements` (ledger
 * append-only) dan `stock_cost_layers` (lapisan FIFO/FEFO). Tidak memakai izin
 * tulis — hanya `inventory.stock.read`. Nilai akhir layer == valuasi FIFO kini.
 */

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

/** Signed quantity: +in, -out. */
const signedQty = sql<string>`case when ${stockMovements.direction} = 'in' then ${stockMovements.quantity} else -${stockMovements.quantity} end`;

interface ProductRef {
  id: string;
  sku: string;
  name: string;
}

async function requireProduct(reader: Reader, productId: string): Promise<ProductRef> {
  const [row] = await reader
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
    })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  if (!row) throw notFound("Produk tidak ditemukan.");
  return row;
}

/* ----------------------------- Kartu stok ---------------------------- */

export async function stockCard(actor: AuthContext, query: StockCardQuery, externalTx?: Tx) {
  assertCan(actor, "inventory.stock.read");
  const reader = externalTx ?? db;
  const product = await requireProduct(reader, query.productId);

  const scope = [
    eq(stockMovements.productId, query.productId),
    query.warehouseId === undefined ? undefined : eq(stockMovements.warehouseId, query.warehouseId),
  ];

  // Saldo awal: seluruh pergerakan sebelum `from` (atau nol bila tanpa from).
  let openingQty = "0";
  let openingVal = "0";
  if (query.from !== undefined) {
    const openingConditions = [
      ...scope,
      lt(stockMovements.movementDate, query.from),
    ];
    const [opening] = await reader
      .select({
        quantity: sql<string>`coalesce(sum(${signedQty}), 0)::numeric(18,3)`,
        value: sql<string>`coalesce(sum(case when ${stockMovements.direction} = 'in' then ${stockMovements.totalCost} else -coalesce(${stockMovements.totalCost}, 0) end), 0)::numeric(18,2)`,
      })
      .from(stockMovements)
      .where(and(...openingConditions));
    openingQty = opening?.quantity ?? "0";
    openingVal = opening?.value ?? "0";
  }

  const rangeConditions = [
    ...scope,
    query.from === undefined ? undefined : gte(stockMovements.movementDate, query.from),
    query.to === undefined ? undefined : lte(stockMovements.movementDate, query.to),
  ];

  const movements = await reader
    .select({
      id: stockMovements.id,
      movementDate: stockMovements.movementDate,
      warehouseId: stockMovements.warehouseId,
      warehouseCode: warehouses.code,
      warehouseName: warehouses.name,
      direction: stockMovements.direction,
      quantity: stockMovements.quantity,
      unitCost: stockMovements.unitCost,
      totalCost: stockMovements.totalCost,
      sourceType: stockMovements.sourceType,
      sourceDocNo: stockMovements.sourceDocNo,
      memo: stockMovements.memo,
    })
    .from(stockMovements)
    .innerJoin(warehouses, eq(warehouses.id, stockMovements.warehouseId))
    .where(and(...rangeConditions))
    .orderBy(asc(stockMovements.movementDate), asc(stockMovements.id));

  let runningQty = dec(openingQty);
  let runningValue = dec(openingVal);
  const rows = movements.map((m) => {
    const signed = m.direction === "in" ? dec(m.quantity) : dec(m.quantity).negated();
    const cost =
      m.direction === "in" ? dec(m.totalCost) : dec(m.totalCost).negated();
    runningQty = runningQty.plus(signed);
    runningValue = runningValue.plus(cost);
    return {
      id: m.id,
      movementDate: m.movementDate,
      warehouseId: m.warehouseId,
      warehouseCode: m.warehouseCode,
      warehouseName: m.warehouseName,
      direction: m.direction,
      quantity: toDb(m.quantity, QTY_DP),
      unitCost: m.unitCost === null ? null : toDb(m.unitCost, COST_DP),
      totalCost: m.totalCost === null ? null : toDb(m.totalCost, TOTAL_DP),
      sourceType: m.sourceType,
      sourceDocNo: m.sourceDocNo,
      memo: m.memo,
      balanceQuantity: toDb(runningQty, QTY_DP),
      balanceValue: toDb(runningValue, TOTAL_DP),
    };
  });

  return {
    product,
    warehouseId: query.warehouseId ?? null,
    from: query.from ?? null,
    to: query.to ?? null,
    openingQuantity: toDb(openingQty, QTY_DP),
    openingValue: toDb(openingVal, TOTAL_DP),
    closingQuantity: toDb(runningQty, QTY_DP),
    closingValue: toDb(runningValue, TOTAL_DP),
    rows,
  };
}

/* --------------------------- Valuasi stok ---------------------------- */

export async function inventoryValuation(
  actor: AuthContext,
  query: InventoryValuationQuery,
  externalTx?: Tx,
) {
  assertCan(actor, "inventory.stock.read");
  const reader = externalTx ?? db;

  const conditions = [
    gtRemaining(),
    query.productId === undefined ? undefined : eq(stockCostLayers.productId, query.productId),
    query.warehouseId === undefined ? undefined : eq(stockCostLayers.warehouseId, query.warehouseId),
    query.branchId === undefined ? undefined : eq(warehouses.branchId, query.branchId),
  ];

  const rows = await reader
    .select({
      productId: stockCostLayers.productId,
      productSku: products.sku,
      productName: products.name,
      warehouseId: stockCostLayers.warehouseId,
      warehouseCode: warehouses.code,
      warehouseName: warehouses.name,
      remaining: sql<string>`coalesce(sum(${stockCostLayers.quantityRemaining}), 0)::numeric(18,3)`,
      value: sql<string>`coalesce(sum(${stockCostLayers.quantityRemaining} * ${stockCostLayers.unitCost}), 0)::numeric(18,2)`,
      layerCount: sql<number>`count(*)::int`,
    })
    .from(stockCostLayers)
    .innerJoin(products, eq(products.id, stockCostLayers.productId))
    .innerJoin(warehouses, eq(warehouses.id, stockCostLayers.warehouseId))
    .where(and(...conditions))
    .groupBy(
      stockCostLayers.productId,
      products.sku,
      products.name,
      stockCostLayers.warehouseId,
      warehouses.code,
      warehouses.name,
    )
    .orderBy(asc(products.sku), asc(warehouses.code));

  const totalValue = rows.reduce((acc, r) => acc.plus(dec(r.value)), dec(0));
  const totalRemaining = rows.reduce((acc, r) => acc.plus(dec(r.remaining)), dec(0));

  return {
    asOf: "current",
    totalRemainingQuantity: toDb(totalRemaining, QTY_DP),
    totalValue: toDb(totalValue, TOTAL_DP),
    rows: rows.map((r) => ({
      ...r,
      remaining: toDb(r.remaining, QTY_DP),
      value: toDb(r.value, TOTAL_DP),
      averageUnitCost:
        cmp(r.remaining, "0") > 0
          ? toDb(dec(r.value).div(dec(r.remaining)), COST_DP)
          : "0.0000",
    })),
  };
}

/** Lapisan dengan sisa > 0 (predikat bersama laporan berbasis layer). */
function gtRemaining() {
  return sql`${stockCostLayers.quantityRemaining} > 0`;
}

/* ----------------------------- Reorder ------------------------------- */

export async function reorderReport(
  actor: AuthContext,
  query: ReorderQuery,
  externalTx?: Tx,
) {
  assertCan(actor, "inventory.stock.read");
  const reader = externalTx ?? db;

  // Stok tersedia per produk (agregat seluruh gudang dalam filter), vs reorderPoint.
  const conditions = [
    isNotNull(products.reorderPoint),
    query.productId === undefined ? undefined : eq(products.id, query.productId),
    query.warehouseId === undefined ? undefined : eq(stockMovements.warehouseId, query.warehouseId),
    query.branchId === undefined ? undefined : eq(warehouses.branchId, query.branchId),
  ];

  const rows = await reader
    .select({
      productId: products.id,
      productSku: products.sku,
      productName: products.name,
      reorderPoint: products.reorderPoint,
      onHand: sql<string>`coalesce(sum(${signedQty}), 0)::numeric(18,3)`,
    })
    .from(products)
    .leftJoin(stockMovements, eq(stockMovements.productId, products.id))
    .leftJoin(warehouses, eq(warehouses.id, stockMovements.warehouseId))
    .where(and(...conditions))
    .groupBy(products.id, products.sku, products.name, products.reorderPoint)
    .orderBy(asc(products.sku));

  const below = rows
    .filter((r) => r.reorderPoint !== null && cmp(r.onHand, r.reorderPoint) < 0)
    .map((r) => {
      const rp = r.reorderPoint as string;
      return {
        productId: r.productId,
        productSku: r.productSku,
        productName: r.productName,
        reorderPoint: toDb(rp, QTY_DP),
        onHand: toDb(r.onHand, QTY_DP),
        suggestedQuantity: toDb(dec(rp).minus(dec(r.onHand)), QTY_DP),
      };
    });

  return { count: below.length, rows: below };
}

/* --------------------------- Jadwal expiry --------------------------- */

export async function expirySchedule(
  actor: AuthContext,
  query: ExpiryScheduleQuery,
  externalTx?: Tx,
) {
  assertCan(actor, "inventory.stock.read");
  const reader = externalTx ?? db;

  const asOf = query.asOf ?? new Date().toISOString().slice(0, 10);
  const withinDays = query.withinDays ?? 90;
  const includeExpired = query.includeExpired ?? false;

  // Batas atas jendela: asOf + withinDays (perbandingan tanggal ISO aman lexicografis).
  const horizon = addDays(asOf, withinDays);

  const conditions = [
    gtRemaining(),
    sql`${stockCostLayers.expiryDate} is not null`,
    query.productId === undefined ? undefined : eq(stockCostLayers.productId, query.productId),
    query.warehouseId === undefined ? undefined : eq(stockCostLayers.warehouseId, query.warehouseId),
    query.branchId === undefined ? undefined : eq(warehouses.branchId, query.branchId),
    includeExpired ? undefined : sql`${stockCostLayers.expiryDate} >= ${asOf}`,
    sql`${stockCostLayers.expiryDate} <= ${horizon}`,
  ];

  const rows = await reader
    .select({
      productId: stockCostLayers.productId,
      productSku: products.sku,
      productName: products.name,
      warehouseId: stockCostLayers.warehouseId,
      warehouseCode: warehouses.code,
      warehouseName: warehouses.name,
      batchId: stockCostLayers.batchId,
      expiryDate: stockCostLayers.expiryDate,
      remaining: sql<string>`coalesce(sum(${stockCostLayers.quantityRemaining}), 0)::numeric(18,3)`,
      value: sql<string>`coalesce(sum(${stockCostLayers.quantityRemaining} * ${stockCostLayers.unitCost}), 0)::numeric(18,2)`,
    })
    .from(stockCostLayers)
    .innerJoin(products, eq(products.id, stockCostLayers.productId))
    .innerJoin(warehouses, eq(warehouses.id, stockCostLayers.warehouseId))
    .where(and(...conditions))
    .groupBy(
      stockCostLayers.productId,
      products.sku,
      products.name,
      stockCostLayers.warehouseId,
      warehouses.code,
      warehouses.name,
      stockCostLayers.batchId,
      stockCostLayers.expiryDate,
    )
    .orderBy(asc(stockCostLayers.expiryDate), asc(products.sku), asc(warehouses.code));

  return {
    asOf,
    horizon,
    includeExpired,
    rows: rows.map((r) => ({
      productId: r.productId,
      productSku: r.productSku,
      productName: r.productName,
      warehouseId: r.warehouseId,
      warehouseCode: r.warehouseCode,
      warehouseName: r.warehouseName,
      batchId: r.batchId,
      expiryDate: r.expiryDate,
      remaining: toDb(r.remaining, QTY_DP),
      value: toDb(r.value, TOTAL_DP),
      daysToExpiry: daysBetween(asOf, r.expiryDate ?? asOf),
      status: (r.expiryDate ?? asOf) < asOf ? "expired" : "active",
    })),
  };
}

/* ------------------------------ Util tanggal ------------------------------ */

/** Selisih hari ISO (b - a); negatif bila b sebelum a. */
function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** Tambah N hari ke tanggal ISO (YYYY-MM-DD). */
function addDays(date: string, days: number): string {
  const base = Date.parse(`${date}T00:00:00Z`);
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}
