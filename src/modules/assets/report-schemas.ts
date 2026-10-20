import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Laporan aset (Tahap 8B) — sisi baca murni                           */
/* ------------------------------------------------------------------ */
// Nominal string desimal 2 dp. Subledger: register aset tidak-dilepas (cost &
// accumulated). GL: baris jurnal posted+reversed pada akun aset di companySettings.

const uuidSchema = z.uuid("Format ID tidak valid.");

/** Register aset tetap: filter kategori/cabang/status. */
export const assetRegisterQuerySchema = z.strictObject({
  categoryId: uuidSchema.optional(),
  branchId: uuidSchema.optional(),
  status: z.enum(["draft", "active", "idle", "in_service", "disposed"]).optional(),
});

/** Rekonsiliasi subledger↔GL aset (posisi kini). Tanpa parameter. */
export const assetReconciliationQuerySchema = z.strictObject({});

export type AssetRegisterQuery = z.output<typeof assetRegisterQuerySchema>;
export type AssetReconciliationQuery = z.output<typeof assetReconciliationQuerySchema>;
