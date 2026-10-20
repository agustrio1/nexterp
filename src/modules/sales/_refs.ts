import { eq } from "drizzle-orm";

import { branches, currencies, customers, products, warehouses } from "@/db/schema";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { businessRule, conflict, forbidden, validationFailed } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Guard izin seragam untuk seluruh service sales. */
export function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

/** Mata uang harus ada & aktif. */
export async function assertActiveCurrency(tx: Tx, code: string, path = "currency"): Promise<void> {
  const [row] = await tx
    .select({ code: currencies.code, isActive: currencies.isActive })
    .from(currencies)
    .where(eq(currencies.code, code))
    .for("share")
    .limit(1);
  if (!row) throw validationFailed([{ path, message: "Mata uang tidak ditemukan." }]);
  if (!row.isActive) throw conflict("Mata uang tidak aktif.");
}

/** Cabang harus aktif. */
export async function assertActiveBranch(tx: Tx, branchId: string): Promise<void> {
  const [row] = await tx
    .select({ id: branches.id, isActive: branches.isActive })
    .from(branches)
    .where(eq(branches.id, branchId))
    .limit(1);
  if (!row) throw validationFailed([{ path: "branchId", message: "Cabang tidak ditemukan." }]);
  if (!row.isActive) throw conflict("Cabang tidak aktif.");
}

/** Customer harus ada & aktif. */
export async function requireActiveCustomer(tx: Tx, customerId: string, path = "customerId") {
  const [row] = await tx
    .select({
      id: customers.id,
      code: customers.code,
      currency: customers.currency,
      creditLimit: customers.creditLimit,
      isActive: customers.isActive,
    })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  if (!row) throw validationFailed([{ path, message: "Pelanggan tidak ditemukan." }]);
  if (!row.isActive) throw conflict("Pelanggan tidak aktif.");
  return row;
}

/** Produk aktif & boleh dijual. */
export async function requireSellableProduct(tx: Tx, productId: string, path = "productId") {
  const [row] = await tx
    .select({ id: products.id, isActive: products.isActive, canSell: products.canSell, tracking: products.tracking, name: products.name })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  if (!row) throw validationFailed([{ path, message: "Produk tidak ditemukan." }]);
  if (!row.isActive) throw conflict(`Produk "${row.name}" tidak aktif.`);
  if (!row.canSell) throw conflict(`Produk "${row.name}" tidak untuk dijual.`);
  return row;
}

/** Gudang aktif milik cabang — dipakai pengiriman/retur. */
export async function assertBranchWarehouse(tx: Tx, warehouseId: string, branchId: string, path = "warehouseId"): Promise<void> {
  const [row] = await tx
    .select({ id: warehouses.id, branchId: warehouses.branchId, isActive: warehouses.isActive, code: warehouses.code })
    .from(warehouses)
    .where(eq(warehouses.id, warehouseId))
    .limit(1);
  if (!row) throw validationFailed([{ path, message: "Gudang tidak ditemukan." }]);
  if (row.branchId !== branchId) throw validationFailed([{ path, message: "Gudang bukan milik cabang dokumen." }]);
  if (!row.isActive) throw businessRule(`Gudang ${row.code} tidak aktif.`);
}
