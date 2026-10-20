import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Laporan pembelian & AP (Tahap 5H) — sisi baca murni                  */
/* ------------------------------------------------------------------ */
// Aging AP berbasis sisa (totalBase invoice posted − alokasi pembayaran posted).
// Rekonsiliasi mencocokkan subledger AP/GR-IR/persediaan dengan GL (jurnal
// posted+reversed) — sumber tunggal kebenaran akuntansi. Nominal string desimal 2 dp.

const dateSchema = z.iso.date("Tanggal harus berformat YYYY-MM-DD.");
const uuidSchema = z.uuid("Format ID tidak valid.");

/**
 * Aging AP: invoice posted bersisa (> 0) dikelompokkan per umur jatuh tempo
 * terhadap `asOf` (default hari ini). Filter opsional supplier/cabang.
 */
export const apAgingQuerySchema = z.strictObject({
  asOf: dateSchema.optional(),
  supplierId: uuidSchema.optional(),
  branchId: uuidSchema.optional(),
});

/**
 * Laporan pembelian: ringkasan PO/GR/invoice/pembayaran per pemasok dalam rentang
 * tanggal. Rentang opsional; bila diisi `to >= from`.
 */
export const purchaseReportQuerySchema = z
  .strictObject({
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    supplierId: uuidSchema.optional(),
    branchId: uuidSchema.optional(),
  })
  .refine((value) => !value.from || !value.to || value.to >= value.from, {
    path: ["to"],
    message: "to tidak boleh sebelum from.",
  });

/** Rekonsiliasi subledger↔GL (posisi kini). Tanpa parameter. */
export const apReconciliationQuerySchema = z.strictObject({});

/* ------------------------------------------------------------------ */
/* Tipe                                                                */
/* ------------------------------------------------------------------ */

export type ApAgingQuery = z.output<typeof apAgingQuerySchema>;
export type PurchaseReportQuery = z.output<typeof purchaseReportQuerySchema>;
export type ApReconciliationQuery = z.output<typeof apReconciliationQuerySchema>;
