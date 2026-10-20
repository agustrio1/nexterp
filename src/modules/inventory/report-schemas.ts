import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Laporan persediaan (Tahap 5H) — sisi baca murni                      */
/* ------------------------------------------------------------------ */
// Semua laporan read-only, sumber ledger terposting (stock_movements &
// stock_cost_layers). Kuantitas string desimal 3 dp, nilai 2 dp. Tidak ada
// waktu-perjalanan (as-of) pada valuasi — lapisan biaya menyimpan sisa berjalan
// (konsisten keputusan 5C), jadi valuasi selalu mencerminkan posisi kini.

const dateSchema = z.iso.date("Tanggal harus berformat YYYY-MM-DD.");
const uuidSchema = z.uuid("Format ID tidak valid.");
const booleanFlag = z
  .enum(["true", "false"])
  .transform((value) => value === "true")
  .optional();

/** Jendela tanggal opsional: keduanya atau bukan sama sekali; to >= from. */

/**
 * Kartu stok: pergerakan + saldo berjalan per produk (opsional per gudang) dalam
 * rentang tanggal. `productId` wajib.
 */
export const stockCardQuerySchema = z
  .strictObject({
    productId: uuidSchema,
    warehouseId: uuidSchema.optional(),
    from: dateSchema.optional(),
    to: dateSchema.optional(),
  })
  .refine((value) => !value.from || !value.to || value.to >= value.from, {
    path: ["to"],
    message: "to tidak boleh sebelum from.",
  });

/**
 * Valuasi persediaan: Σ `quantityRemaining × unitCost` lapisan per produk+gudang.
 * Filter opsional produk/gudang/cabang. Posisi kini (tanpa as-of).
 */
export const inventoryValuationQuerySchema = z.strictObject({
  productId: uuidSchema.optional(),
  warehouseId: uuidSchema.optional(),
  branchId: uuidSchema.optional(),
});

/**
 * Reorder: produk dengan `reorderPoint` terisi dan stok tersedia (per gudang,
 * difilter cabang) di bawah titik pemesanan kembali.
 */
export const reorderQuerySchema = z.strictObject({
  productId: uuidSchema.optional(),
  warehouseId: uuidSchema.optional(),
  branchId: uuidSchema.optional(),
});

/**
 * Jadwal kedaluwarsa (FEFO/expiry): lapisan bersisa dengan tanggal expiry, urut
 * terdekat. `asOf` default hari ini; `withinDays` default 90; `includeExpired`
 * default false (hanya yang belum lewat).
 */
export const expiryScheduleQuerySchema = z.strictObject({
  asOf: dateSchema.optional(),
  withinDays: z.coerce
    .number()
    .int("withinDays harus bilangan bulat.")
    .min(0, "withinDays minimal 0.")
    .max(3650, "withinDays maksimal 3650.")
    .optional(),
  includeExpired: booleanFlag,
  productId: uuidSchema.optional(),
  warehouseId: uuidSchema.optional(),
  branchId: uuidSchema.optional(),
});

/* ------------------------------------------------------------------ */
/* Tipe                                                                */
/* ------------------------------------------------------------------ */

export type StockCardQuery = z.output<typeof stockCardQuerySchema>;
export type InventoryValuationQuery = z.output<typeof inventoryValuationQuerySchema>;
export type ReorderQuery = z.output<typeof reorderQuerySchema>;
export type ExpiryScheduleQuery = z.output<typeof expiryScheduleQuerySchema>;
