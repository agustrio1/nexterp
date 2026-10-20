import { and, asc, eq, sql } from "drizzle-orm";

import { productCategories, products } from "@/db/schema";
import type {
  CreateProductCategoryInput,
  ListProductCategoriesQuery,
  UpdateProductCategoryInput,
} from "@/modules/inventory/schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { businessRule, conflict, forbidden, notFound, validationFailed } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "select">;

const MAX_HIERARCHY_DEPTH = 100;

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

const categoryColumns = {
  id: productCategories.id,
  code: productCategories.code,
  name: productCategories.name,
  parentId: productCategories.parentId,
  isActive: productCategories.isActive,
  description: productCategories.description,
  createdAt: productCategories.createdAt,
  updatedAt: productCategories.updatedAt,
};

async function requireCategory(reader: Reader, id: string) {
  const [row] = await reader
    .select(categoryColumns)
    .from(productCategories)
    .where(eq(productCategories.id, id))
    .limit(1);
  if (!row) throw notFound("Kategori produk tidak ditemukan.");
  return row;
}

async function lockCategory(tx: Tx, id: string) {
  const [row] = await tx
    .select(categoryColumns)
    .from(productCategories)
    .where(eq(productCategories.id, id))
    .for("update")
    .limit(1);
  if (!row) throw notFound("Kategori produk tidak ditemukan.");
  return row;
}

async function lockParentShared(tx: Tx, parentId: string) {
  const [parent] = await tx
    .select({ id: productCategories.id, isActive: productCategories.isActive })
    .from(productCategories)
    .where(eq(productCategories.id, parentId))
    .for("share")
    .limit(1);
  if (!parent) {
    throw validationFailed([{ path: "parentId", message: "Kategori induk tidak ditemukan." }]);
  }
  return parent;
}

async function assertNoCycle(tx: Tx, categoryId: string, newParentId: string): Promise<void> {
  let currentId: string | null = newParentId;
  for (let depth = 0; depth < MAX_HIERARCHY_DEPTH && currentId !== null; depth++) {
    if (currentId === categoryId) {
      throw businessRule("Perubahan induk membentuk siklus pada hierarki kategori.");
    }
    const [row] = await tx
      .select({ parentId: productCategories.parentId })
      .from(productCategories)
      .where(eq(productCategories.id, currentId))
      .limit(1);
    currentId = row?.parentId ?? null;
  }
  if (currentId !== null) {
    throw new Error(`Hierarki kategori tidak wajar (lebih dari ${MAX_HIERARCHY_DEPTH} tingkat).`);
  }
}

async function countChildren(tx: Tx, parentId: string, activeOnly: boolean): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(productCategories)
    .where(
      activeOnly
        ? and(eq(productCategories.parentId, parentId), eq(productCategories.isActive, true))
        : eq(productCategories.parentId, parentId),
    );
  return row?.count ?? 0;
}

async function countProducts(tx: Tx, categoryId: string): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(products)
    .where(eq(products.categoryId, categoryId));
  return row?.count ?? 0;
}

/* ------------------------------- Baca ------------------------------ */

export async function listProductCategories(
  actor: AuthContext,
  query: ListProductCategoriesQuery = {},
  externalTx?: Tx,
) {
  assertCan(actor, "inventory.product_categories.read");
  const reader = externalTx ?? db;

  const conditions = [
    query.isActive === undefined ? undefined : eq(productCategories.isActive, query.isActive),
    query.parentId === undefined ? undefined : eq(productCategories.parentId, query.parentId),
  ];

  return reader
    .select(categoryColumns)
    .from(productCategories)
    .where(and(...conditions))
    .orderBy(asc(productCategories.code));
}

export async function getProductCategory(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "inventory.product_categories.read");
  return requireCategory(externalTx ?? db, id);
}

/* ------------------------------- Tulis ----------------------------- */

export async function createProductCategory(
  actor: AuthContext,
  input: CreateProductCategoryInput,
  externalTx?: Tx,
) {
  assertCan(actor, "inventory.product_categories.manage");

  const run = async (tx: Tx) => {
    const [dup] = await tx
      .select({ id: productCategories.id })
      .from(productCategories)
      .where(eq(productCategories.code, input.code))
      .limit(1);
    if (dup) throw conflict("Kode kategori sudah dipakai.");

    const parentId = input.parentId ?? null;
    if (parentId !== null) {
      const parent = await lockParentShared(tx, parentId);
      if (!parent.isActive) throw businessRule("Kategori induk tidak aktif.");
    }

    const values = { code: input.code, name: input.name, parentId, description: input.description ?? null };

    const [created] = await tx
      .insert(productCategories)
      .values({ ...values, isActive: true, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: productCategories.id });
    if (!created) throw new Error("Gagal membuat kategori produk.");

    await audit.log(
      {
        action: "product_category.create",
        entityType: "product_category",
        entityId: created.id,
        actorId: actor.userId,
        after: values,
      },
      tx,
    );

    return requireCategory(tx, created.id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

const UPDATABLE_FIELDS = ["name", "parentId", "description", "isActive"] as const;

export async function updateProductCategory(
  actor: AuthContext,
  id: string,
  input: UpdateProductCategoryInput,
  externalTx?: Tx,
) {
  assertCan(actor, "inventory.product_categories.manage");

  const run = async (tx: Tx) => {
    const touchesHierarchy = input.parentId !== undefined || input.isActive !== undefined;
    if (touchesHierarchy) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('erp.inventory.categories.hierarchy'))`);
    }

    const category = await lockCategory(tx, id);

    const next = {
      name: input.name ?? category.name,
      parentId: input.parentId === undefined ? category.parentId : input.parentId,
      description: input.description === undefined ? category.description : input.description,
      isActive: input.isActive ?? category.isActive,
    };

    const changedFields = UPDATABLE_FIELDS.filter((field) => next[field] !== category[field]);
    if (changedFields.length === 0) return category;

    if (next.parentId === id) {
      throw businessRule("Kategori tidak dapat menjadi induk bagi dirinya sendiri.");
    }

    const parentChanged = next.parentId !== category.parentId;
    const deactivating = category.isActive && !next.isActive;

    if (parentChanged && next.parentId !== null) {
      const parent = await lockParentShared(tx, next.parentId);
      if (!parent.isActive) throw businessRule("Kategori induk tidak aktif.");
      await assertNoCycle(tx, id, next.parentId);
    }

    if (deactivating) {
      const activeChildren = await countChildren(tx, id, true);
      if (activeChildren > 0) {
        throw conflict(`Kategori masih memiliki ${activeChildren} sub-kategori aktif.`);
      }
      const usedBy = await countProducts(tx, id);
      if (usedBy > 0) {
        throw conflict(`Kategori masih dipakai oleh ${usedBy} produk.`);
      }
    }

    await tx
      .update(productCategories)
      .set({ ...next, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(productCategories.id, id));

    await audit.log(
      {
        action: "product_category.update",
        entityType: "product_category",
        entityId: id,
        actorId: actor.userId,
        before: Object.fromEntries(changedFields.map((field) => [field, category[field]])),
        after: Object.fromEntries(changedFields.map((field) => [field, next[field]])),
      },
      tx,
    );

    return requireCategory(tx, id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}
