import { and, asc, eq, ilike, or, sql, type SQL } from "drizzle-orm";

import {
  productCategories,
  products,
  stockMovements,
  unitsOfMeasure,
} from "@/db/schema";
import { assertActiveUnit } from "@/modules/inventory/unit-service";
import { toDb } from "@/lib/money";
import type {
  CreateProductInput,
  ListProductsQuery,
  UpdateProductInput,
} from "@/modules/inventory/schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { businessRule, conflict, forbidden, notFound, validationFailed } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Tx | typeof db;

const QTY_DP = 3;

function normalizeReorderPoint(value: string | null | undefined): string | null {
  return value === null || value === undefined ? null : toDb(value, QTY_DP);
}

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

const productColumns = {
  id: products.id,
  sku: products.sku,
  name: products.name,
  categoryId: products.categoryId,
  categoryName: productCategories.name,
  baseUnitId: products.baseUnitId,
  baseUnitCode: unitsOfMeasure.code,
  baseUnitName: unitsOfMeasure.name,
  canPurchase: products.canPurchase,
  canSell: products.canSell,
  isActive: products.isActive,
  tracking: products.tracking,
  needsExpiry: products.needsExpiry,
  reorderPoint: products.reorderPoint,
  description: products.description,
  createdAt: products.createdAt,
  updatedAt: products.updatedAt,
};

function productQuery(reader: Reader) {
  return reader
    .select(productColumns)
    .from(products)
    .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
    .innerJoin(unitsOfMeasure, eq(unitsOfMeasure.id, products.baseUnitId));
}

async function requireProduct(reader: Reader, id: string) {
  const [row] = await productQuery(reader).where(eq(products.id, id)).limit(1);
  if (!row) throw notFound("Produk tidak ditemukan.");
  return row;
}

/** Kategori opsional: bila diisi harus ada & aktif. */
async function assertActiveCategory(tx: Tx, categoryId: string | null, path = "categoryId"): Promise<void> {
  if (categoryId === null) return;
  const [row] = await tx
    .select({ id: productCategories.id, isActive: productCategories.isActive })
    .from(productCategories)
    .where(eq(productCategories.id, categoryId))
    .for("share")
    .limit(1);
  if (!row) throw validationFailed([{ path, message: "Kategori produk tidak ditemukan." }]);
  if (!row.isActive) throw conflict("Kategori produk tidak aktif.");
}

/* ------------------------------- Baca ------------------------------ */

export async function listProducts(actor: AuthContext, query: ListProductsQuery = {}, externalTx?: Tx) {
  assertCan(actor, "inventory.products.read");
  const reader = externalTx ?? db;

  const conditions: (SQL | undefined)[] = [
    query.isActive === undefined ? undefined : eq(products.isActive, query.isActive),
    query.categoryId === undefined ? undefined : eq(products.categoryId, query.categoryId),
    query.baseUnitId === undefined ? undefined : eq(products.baseUnitId, query.baseUnitId),
    query.search === undefined
      ? undefined
      : or(ilike(products.name, `%${query.search}%`), ilike(products.sku, `%${query.search}%`)),
  ];

  return productQuery(reader)
    .where(and(...conditions))
    .orderBy(asc(products.sku));
}

export async function getProduct(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "inventory.products.read");
  return requireProduct(externalTx ?? db, id);
}

/* ------------------------------- Tulis ----------------------------- */

export async function createProduct(actor: AuthContext, input: CreateProductInput, externalTx?: Tx) {
  assertCan(actor, "inventory.products.manage");

  const run = async (tx: Tx) => {
    const [dup] = await tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.sku, input.sku))
      .limit(1);
    if (dup) throw conflict("SKU sudah dipakai.");

    const categoryId = input.categoryId ?? null;
    await assertActiveCategory(tx, categoryId);
    await assertActiveUnit(tx, input.baseUnitId);

    const values = {
      sku: input.sku,
      name: input.name,
      categoryId,
      baseUnitId: input.baseUnitId,
      canPurchase: input.canPurchase ?? true,
      canSell: input.canSell ?? true,
      tracking: input.tracking ?? "none",
      needsExpiry: input.needsExpiry ?? false,
      reorderPoint: normalizeReorderPoint(input.reorderPoint),
      description: input.description ?? null,
    };

    const [created] = await tx
      .insert(products)
      .values({ ...values, isActive: true, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: products.id });
    if (!created) throw new Error("Gagal membuat produk.");

    await audit.log(
      {
        action: "product.create",
        entityType: "product",
        entityId: created.id,
        actorId: actor.userId,
        after: values,
      },
      tx,
    );
    return requireProduct(tx, created.id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

const UPDATABLE_FIELDS = [
  "name",
  "categoryId",
  "baseUnitId",
  "canPurchase",
  "canSell",
  "isActive",
  "tracking",
  "needsExpiry",
  "reorderPoint",
  "description",
] as const;

export async function updateProduct(actor: AuthContext, id: string, input: UpdateProductInput, externalTx?: Tx) {
  assertCan(actor, "inventory.products.manage");

  const run = async (tx: Tx) => {
    // SKU tidak dapat diubah (identitas master).
    const [existing] = await tx
      .select({
        id: products.id,
        name: products.name,
        categoryId: products.categoryId,
        baseUnitId: products.baseUnitId,
        canPurchase: products.canPurchase,
        canSell: products.canSell,
        isActive: products.isActive,
        tracking: products.tracking,
        needsExpiry: products.needsExpiry,
        reorderPoint: products.reorderPoint,
        description: products.description,
      })
      .from(products)
      .where(eq(products.id, id))
      .for("update")
      .limit(1);
    if (!existing) throw notFound("Produk tidak ditemukan.");

    const next = {
      name: input.name ?? existing.name,
      categoryId: input.categoryId === undefined ? existing.categoryId : input.categoryId,
      baseUnitId: input.baseUnitId ?? existing.baseUnitId,
      canPurchase: input.canPurchase ?? existing.canPurchase,
      canSell: input.canSell ?? existing.canSell,
      isActive: input.isActive ?? existing.isActive,
      tracking: input.tracking ?? existing.tracking,
      needsExpiry: input.needsExpiry ?? existing.needsExpiry,
      reorderPoint:
        input.reorderPoint === undefined
          ? existing.reorderPoint
          : normalizeReorderPoint(input.reorderPoint),
      description: input.description === undefined ? existing.description : input.description,
    };

    const changedFields = UPDATABLE_FIELDS.filter((field) => next[field] !== existing[field]);
    if (changedFields.length === 0) return requireProduct(tx, id);

    if (changedFields.includes("categoryId")) {
      await assertActiveCategory(tx, next.categoryId);
    }
    if (changedFields.includes("baseUnitId")) {
      await assertActiveUnit(tx, next.baseUnitId);
    }
    // 5E-batch: metode tracking hanya boleh berubah selama produk belum punya
    // pergerakan stok — riwayat lama tidak boleh ditafsir ulang.
    if (changedFields.includes("tracking") || changedFields.includes("needsExpiry")) {
      const [mv] = await tx
        .select({ one: sql`1` })
        .from(stockMovements)
        .where(eq(stockMovements.productId, id))
        .limit(1);
      if (mv) throw businessRule("Tracking/kebutuhan expiry tidak dapat diubah setelah produk punya pergerakan stok.");
    }

    await tx
      .update(products)
      .set({ ...next, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(products.id, id));

    await audit.log(
      {
        action: "product.update",
        entityType: "product",
        entityId: id,
        actorId: actor.userId,
        before: Object.fromEntries(changedFields.map((field) => [field, existing[field]])),
        after: Object.fromEntries(changedFields.map((field) => [field, next[field]])),
      },
      tx,
    );
    return requireProduct(tx, id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}
