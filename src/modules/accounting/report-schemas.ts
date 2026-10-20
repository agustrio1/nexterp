import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Laporan keuangan (Tahap 4E) — sisi baca murni                        */
/* ------------------------------------------------------------------ */

/**
 * Konvensi periode laporan: pemanggil memberi sebuah rentang tanggal eksplisit
 * (`from` + `to`) ATAU satu `periodId` yang di-resolve ke tanggal periode.
 * Keduanya tidak boleh diisi bersamaan supaya filter tetap konsisten
 * (lihat keputusan 4E: "filter periode konsisten").
 */
const dateSchema = z.iso.date("Tanggal harus berformat YYYY-MM-DD.");
const uuidSchema = z.uuid("Format ID tidak valid.");

/** Rentang bergerak: from & to wajib, ATAU periodId (dari periode akuntansi). */
const rangeSchema = z
  .strictObject({
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    periodId: uuidSchema.optional(),
    branchId: uuidSchema.optional(),
  })
  .refine(
    (value) => {
      if (value.periodId) return !value.from && !value.to;
      return !!value.from && !!value.to;
    },
    {
      message:
        "Berikan periodId, atau dari & to (keduanya tidak boleh digabung dengan periodId).",
    },
  )
  .refine((value) => !value.from || !value.to || value.to >= value.from, {
    path: ["to"],
    message: "to tidak boleh sebelum from.",
  });

/** Buku besar per akun: saldo awal + mutasi + saldo berjalan. */
export const generalLedgerQuerySchema = rangeSchema.extend({
  accountId: uuidSchema,
  departmentId: uuidSchema.optional(),
});

/** Neraca saldo: total debit & kredit per akun dalam rentang. */
export const trialBalanceQuerySchema = rangeSchema;

/** Laba rugi: pendapatan vs beban dalam rentang. */
export const incomeStatementQuerySchema = rangeSchema;

/**
 * Laporan per pusat biaya: realisasi pendapatan/beban per cost center dalam rentang.
 * Opsional membatasi ke satu `costCenterId` (warisan anak tidak diagregasi otomatis).
 */
export const costCenterReportQuerySchema = rangeSchema.extend({
  costCenterId: uuidSchema.optional(),
});

/**
 * Buku kas/bank: mutasi dan saldo berjalan satu rekening kas/bank dalam rentang.
 * Sumber baris jurnal pada akun GL rekening tersebut (`posted` + `reversed`).
 */
export const cashBookQuerySchema = rangeSchema.extend({
  bankAccountId: uuidSchema,
});

/**
 * Neraca: posisi kumulatif per satu tanggal. `asOf` wajib, ATAU `periodId`
 * (dipakai tanggal akhir periode sebagai titik potong).
 */
export const balanceSheetQuerySchema = z
  .strictObject({
    asOf: dateSchema.optional(),
    periodId: uuidSchema.optional(),
    branchId: uuidSchema.optional(),
  })
  .refine(
    (value) => (value.periodId ? !value.asOf : !!value.asOf),
    { message: "Berikan asOf, atau periodId (tidak keduanya)." },
  );

/* ------------------------------------------------------------------ */
/* Anggaran & arus kas (Tahap 4I)                                      */
/* ------------------------------------------------------------------ */

/**
 * Realisasi vs anggaran: keseluruhan tahun fiskal anggaran, atau dipersempit ke
 * satu periode (`periodId`). Sumber realisasi = baris jurnal `posted`+`reversed`.
 */
export const budgetRealizationQuerySchema = z.strictObject({
  budgetId: uuidSchema,
  periodId: uuidSchema.optional(),
});

/**
 * Laporan arus kas (metode langsung, sumber `cash_transactions` terposting).
 * Rentang dari from/to ATAU periodId, sama seperti laporan lain.
 */
export const cashFlowQuerySchema = rangeSchema;

/* ------------------------------------------------------------------ */
/* Tipe                                                                */
/* ------------------------------------------------------------------ */

export type GeneralLedgerQuery = z.output<typeof generalLedgerQuerySchema>;
export type TrialBalanceQuery = z.output<typeof trialBalanceQuerySchema>;
export type IncomeStatementQuery = z.output<typeof incomeStatementQuerySchema>;
export type CostCenterReportQuery = z.output<typeof costCenterReportQuerySchema>;
export type CashBookQuery = z.output<typeof cashBookQuerySchema>;
export type BalanceSheetQuery = z.output<typeof balanceSheetQuerySchema>;
export type BudgetRealizationQuery = z.output<typeof budgetRealizationQuerySchema>;
export type CashFlowQuery = z.output<typeof cashFlowQuerySchema>;
