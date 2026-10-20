import { eq } from "drizzle-orm";

import { branches, currencies, products, warehouses } from "@/db/schema";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { conflict, forbidden, validationFailed } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Guard izin seragam untuk seluruh service purchasing. */
export function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

/** Mata uang harus ada & aktif; dikunci FOR SHARE agar penonaktifan menunggu transaksi ini. */
export async function assertActiveCurrency(
  tx: Tx,
  code: string,
  path = "currency",
): Promise<void> {
  const [row] = await tx
    .select({ code: currencies.code, isActive: currencies.isActive })
    .from(currencies)
    .where(eq(currencies.code, code))
    .for("share")
    .limit(1);
  if (!row) throw validationFailed([{ path, message: "Mata uang tidak ditemukan." }]);
  if (!row.isActive) throw conflict("Mata uang tidak aktif.");
}

/** Produk aktif & boleh dibeli; mengembalikan atribut tracking untuk validasi GR. */
export async function requirePurchasableProduct(
  tx: Tx,
  productId: string,
  path = "productId",
): Promise<{
  id: string;
  isActive: boolean;
  canPurchase: boolean;
  tracking: "none" | "batch" | "serial" | "both";
  needsExpiry: boolean;
}> {
  const [row] = await tx
    .select({
      id: products.id,
      isActive: products.isActive,
      canPurchase: products.canPurchase,
      tracking: products.tracking,
      needsExpiry: products.needsExpiry,
    })
    .from(products)
    .where(eq(products.id, productId))
    .for("share")
    .limit(1);
  if (!row) throw validationFailed([{ path, message: "Produk tidak ditemukan." }]);
  if (!row.isActive) throw conflict("Produk tidak aktif.");
  if (!row.canPurchase) throw conflict("Produk tidak dapat dibeli (canPurchase=false).");
  return row;
}

/** Cabang harus ada & aktif untuk penempatan dokumen. */
export async function assertActiveBranch(
  tx: Tx,
  branchId: string,
  path = "branchId",
): Promise<void> {
  const [row] = await tx
    .select({ id: branches.id, isActive: branches.isActive })
    .from(branches)
    .where(eq(branches.id, branchId))
    .for("share")
    .limit(1);
  if (!row) throw validationFailed([{ path, message: "Cabang tidak ditemukan." }]);
  if (!row.isActive) throw conflict("Cabang tidak aktif.");
}

/** Gudang aktif milik cabang (untuk gudang penerimaan GR). */
export async function assertReceivingWarehouse(
  tx: Tx,
  warehouseId: string,
  branchId: string,
  path = "warehouseId",
): Promise<void> {
  const [row] = await tx
    .select({ id: warehouses.id, branchId: warehouses.branchId, isActive: warehouses.isActive })
    .from(warehouses)
    .where(eq(warehouses.id, warehouseId))
    .for("share")
    .limit(1);
  if (!row) throw validationFailed([{ path, message: "Gudang tidak ditemukan." }]);
  if (row.branchId !== branchId) {
    throw validationFailed([{ path, message: "Gudang bukan milik cabang PO." }]);
  }
  if (!row.isActive) throw conflict("Gudang tidak aktif.");
}
