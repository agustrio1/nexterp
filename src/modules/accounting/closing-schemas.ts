import { z } from "zod";

import { journalLineSchema } from "@/modules/accounting/schemas";

/* ------------------------------------------------------------------ */
/* Saldo awal & penutupan tahun fiskal (Tahap 4F)                       */
/* ------------------------------------------------------------------ */

const fiscalYearIdSchema = z.uuid("Format ID tahun fiskal tidak valid.");

const descriptionSchema = z
  .string()
  .trim()
  .min(3, "Deskripsi minimal 3 karakter.")
  .max(500, "Deskripsi maksimal 500 karakter.");

const referenceSchema = z
  .string()
  .trim()
  .max(50, "Referensi maksimal 50 karakter.")
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional();

/**
 * Saldo awal: dibuat sebagai draf jurnal ber-sumber `opening_balance`. Baris
 * supplied pengguna (satu sisi per baris), keseimbangan divalidasi mesin jurnal
 * saat posting. Tanggal & periode ditentukan service (awal tahun fiskal).
 */
export const createOpeningBalanceSchema = z.strictObject({
  fiscalYearId: fiscalYearIdSchema,
  description: descriptionSchema,
  reference: referenceSchema,
  lines: z.array(journalLineSchema).min(2, "Saldo awal membutuhkan minimal dua baris.").max(200),
  idempotencyKey: z
    .string()
    .trim()
    .min(8, "idempotencyKey minimal 8 karakter.")
    .max(200, "idempotencyKey maksimal 200 karakter.")
    .optional(),
});

/**
 * Jurnal penutup: baris dihitung otomatis oleh service (menolkan pendapatan &
 * beban ke akun laba ditahan). Hanya perlu menunjuk tahun fiskal.
 */
export const createClosingEntrySchema = z.strictObject({
  fiscalYearId: fiscalYearIdSchema,
  description: descriptionSchema.optional(),
  reference: referenceSchema,
});

/* ------------------------------------------------------------------ */
/* Tipe                                                                */
/* ------------------------------------------------------------------ */

export type CreateOpeningBalanceInput = z.output<typeof createOpeningBalanceSchema>;
export type CreateClosingEntryInput = z.output<typeof createClosingEntrySchema>;
