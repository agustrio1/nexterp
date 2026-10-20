import { and, asc, eq, type SQL } from "drizzle-orm";

import { priceListItems, priceLists, products } from "@/db/schema";
import type { AddPriceItemInput, CreatePriceListInput, ListQuery, UpdatePriceListInput } from "@/modules/crm/schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { conflict, forbidden, notFound, validationFailed } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

const priceListColumns = {
  id: priceLists.id,
  code: priceLists.code,
  name: priceLists.name,
  validFrom: priceLists.validFrom,
  validTo: priceLists.validTo,
  isActive: priceLists.isActive,
  createdAt: priceLists.createdAt,
  updatedAt: priceLists.updatedAt,
};

export async function listPriceLists(actor: AuthContext, query: ListQuery = {}, externalTx?: Tx) {
  assertCan(actor, "crm.price_lists.read");
  const reader = externalTx ?? db;
  const conditions: (SQL | undefined)[] = [
    query.isActive === undefined ? undefined : eq(priceLists.isActive, query.isActive),
  ];
  return reader.select(priceListColumns).from(priceLists).where(and(...conditions)).orderBy(asc(priceLists.code));
}

export async function getPriceList(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "crm.price_lists.read");
  const reader = externalTx ?? db;
  const [row] = await reader.select(priceListColumns).from(priceLists).where(eq(priceLists.id, id)).limit(1);
  if (!row) throw notFound("Daftar harga tidak ditemukan.");
  const items = await reader
    .select({ id: priceListItems.id, productId: priceListItems.productId, productName: products.name, productSku: products.sku, unitPrice: priceListItems.unitPrice })
    .from(priceListItems)
    .innerJoin(products, eq(products.id, priceListItems.productId))
    .where(eq(priceListItems.priceListId, id))
    .orderBy(asc(products.sku));
  return { ...row, items };
}

export async function createPriceList(actor: AuthContext, input: CreatePriceListInput, externalTx?: Tx) {
  assertCan(actor, "crm.price_lists.manage");
  const run = async (tx: Tx) => {
    const [dup] = await tx.select({ id: priceLists.id }).from(priceLists).where(eq(priceLists.code, input.code)).limit(1);
    if (dup) throw conflict(`Kode daftar harga "${input.code}" sudah dipakai.`);
    const [row] = await tx.insert(priceLists).values({ ...input, createdBy: actor.userId, updatedBy: actor.userId }).returning(priceListColumns);
    await audit.log({ action: "crm.price_list.create", entityType: "price_lists", entityId: row!.id, actorId: actor.userId }, tx);
    return row!;
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function updatePriceList(actor: AuthContext, id: string, input: UpdatePriceListInput, externalTx?: Tx) {
  assertCan(actor, "crm.price_lists.manage");
  const run = async (tx: Tx) => {
    const [current] = await tx.select({ id: priceLists.id }).from(priceLists).where(eq(priceLists.id, id)).for("update").limit(1);
    if (!current) throw notFound("Daftar harga tidak ditemukan.");
    const next: Record<string, unknown> = { updatedAt: new Date(), updatedBy: actor.userId };
    for (const [key, value] of Object.entries(input)) { if (value !== undefined) next[key] = value; }
    const [row] = await tx.update(priceLists).set(next).where(eq(priceLists.id, id)).returning(priceListColumns);
    await audit.log({ action: "crm.price_list.update", entityType: "price_lists", entityId: id, actorId: actor.userId }, tx);
    return row!;
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function addPriceItem(actor: AuthContext, priceListId: string, input: AddPriceItemInput, externalTx?: Tx) {
  assertCan(actor, "crm.price_lists.manage");
  const run = async (tx: Tx) => {
    const [pl] = await tx.select({ id: priceLists.id }).from(priceLists).where(eq(priceLists.id, priceListId)).limit(1);
    if (!pl) throw notFound("Daftar harga tidak ditemukan.");
    const [prod] = await tx.select({ id: products.id }).from(products).where(eq(products.id, input.productId)).limit(1);
    if (!prod) throw validationFailed([{ path: "productId", message: "Produk tidak ditemukan." }]);
    const [dup] = await tx.select({ id: priceListItems.id }).from(priceListItems).where(and(eq(priceListItems.priceListId, priceListId), eq(priceListItems.productId, input.productId))).limit(1);
    if (dup) throw conflict("Produk ini sudah ada dalam daftar harga.");
    const [row] = await tx.insert(priceListItems).values({ priceListId, productId: input.productId, unitPrice: input.unitPrice, createdBy: actor.userId, updatedBy: actor.userId }).returning({ id: priceListItems.id });
    await audit.log({ action: "crm.price_list.add_item", entityType: "price_list_items", entityId: row!.id, actorId: actor.userId }, tx);
    return row!;
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function removePriceItem(actor: AuthContext, priceListId: string, productId: string, externalTx?: Tx) {
  assertCan(actor, "crm.price_lists.manage");
  const run = async (tx: Tx) => {
    await tx.delete(priceListItems).where(and(eq(priceListItems.priceListId, priceListId), eq(priceListItems.productId, productId)));
    await audit.log({ action: "crm.price_list.remove_item", entityType: "price_list_items", entityId: `${priceListId}:${productId}`, actorId: actor.userId }, tx);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}
