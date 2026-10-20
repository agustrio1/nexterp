import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Laporan penjualan & AR (Tahap 6F) — sisi baca murni                  */
/* ------------------------------------------------------------------ */
// Aging AR berbasis sisa (totalBase invoice posted − alokasi pembayaran posted
// − nota kredit posted). Rekonsiliasi mencocokkan subledger AR/persediaan
// dengan GL (jurnal posted+reversed) — sumber tunggal kebenaran akuntansi.
// Nominal string desimal 2 dp.

const dateSchema = z.iso.date("Tanggal harus berformat YYYY-MM-DD.");
const uuidSchema = z.uuid("Format ID tidak valid.");

/**
 * Aging AR: invoice posted bersisa (> 0) dikelompokkan per umur jatuh tempo
 * terhadap `asOf` (default hari ini). Filter opsional customer/cabang.
 */
export const arAgingQuerySchema = z.strictObject({
  asOf: dateSchema.optional(),
  customerId: uuidSchema.optional(),
  branchId: uuidSchema.optional(),
});

/**
 * Laporan penjualan: ringkasan SO/delivery/invoice/pembayaran per pelanggan
 * dalam rentang tanggal. Rentang opsional; bila diisi `to >= from`.
 */
export const salesReportQuerySchema = z
  .strictObject({
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    customerId: uuidSchema.optional(),
    branchId: uuidSchema.optional(),
  })
  .refine((value) => !value.from || !value.to || value.to >= value.from, {
    path: ["to"],
    message: "to tidak boleh sebelum from.",
  });

/** Rekonsiliasi subledger↔GL AR (posisi kini). Tanpa parameter. */
export const arReconciliationQuerySchema = z.strictObject({});

/* ------------------------------------------------------------------ */
/* Tipe                                                                */
/* ------------------------------------------------------------------ */

export type ArAgingQuery = z.output<typeof arAgingQuerySchema>;
export type SalesReportQuery = z.output<typeof salesReportQuerySchema>;
export type ArReconciliationQuery = z.output<typeof arReconciliationQuerySchema>;
