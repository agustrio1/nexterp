import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Helper                                                              */
/* ------------------------------------------------------------------ */

const emptyToNull = (value: string) => (value === "" ? null : value);

const hasAnyField = (value: Record<string, unknown>) =>
  Object.values(value).some((field) => field !== undefined);

const atLeastOneField = { message: "Minimal satu field harus diisi." };

const dateSchema = z.iso.date("Tanggal harus berformat YYYY-MM-DD.");

function parseYmd(value: string): { y: number; m: number; d: number } {
  const [y = 0, m = 0, d = 0] = value.split("-").map(Number);
  return { y, m, d };
}

function lastDayOfMonth(year: number, month: number): number {
  // Hari ke-0 bulan berikutnya = hari terakhir bulan ini.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/* ------------------------------------------------------------------ */
/* Tahun fiskal                                                        */
/* ------------------------------------------------------------------ */

const fiscalYearCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, "Kode tahun fiskal minimal 2 karakter.")
  .max(20, "Kode tahun fiskal maksimal 20 karakter.")
  .regex(
    /^[A-Z0-9][A-Z0-9_-]*$/,
    "Kode tahun fiskal hanya boleh huruf, angka, strip, dan underscore, serta diawali huruf atau angka.",
  );

/**
 * Tahun fiskal terdiri dari 1 sampai 12 bulan penuh: mulai tanggal 1, berakhir di hari terakhir
 * bulan. Periode bulanan dibuat otomatis oleh service dari rentang ini.
 */
export const createFiscalYearSchema = z
  .strictObject({
    code: fiscalYearCodeSchema,
    startDate: dateSchema,
    endDate: dateSchema,
    // Periode ke-13 untuk penyesuaian akhir tahun (opsional).
    includeAdjustmentPeriod: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    const start = parseYmd(value.startDate);
    const end = parseYmd(value.endDate);

    const startAligned = start.d === 1;
    const endAligned = end.d === lastDayOfMonth(end.y, end.m);

    if (!startAligned) {
      ctx.addIssue({ code: "custom", path: ["startDate"], message: "Tanggal awal harus tanggal 1." });
    }
    if (!endAligned) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "Tanggal akhir harus hari terakhir dalam bulan.",
      });
    }
    if (!startAligned || !endAligned) return;

    const months = (end.y - start.y) * 12 + (end.m - start.m) + 1;
    if (months < 1 || months > 12) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "Tahun fiskal harus terdiri dari 1 sampai 12 bulan penuh.",
      });
    }
  });

export const listFiscalYearsQuerySchema = z.strictObject({
  status: z.enum(["open", "closed"]).optional(),
});

/* ------------------------------------------------------------------ */
/* Status periode akuntansi                                            */
/* ------------------------------------------------------------------ */

export const PERIOD_STATUSES = ["open", "soft_closed", "closed"] as const;

/**
 * Menaikkan status (open -> soft_closed -> closed) membutuhkan izin tutup periode; menurunkannya
 * membutuhkan izin buka kembali dan alasan. Kewajiban alasan diperiksa service karena bergantung
 * pada status saat ini.
 */
export const changePeriodStatusSchema = z.strictObject({
  status: z.enum(PERIOD_STATUSES),
  reason: z
    .string()
    .trim()
    .min(5, "Alasan minimal 5 karakter.")
    .max(500, "Alasan maksimal 500 karakter.")
    .optional(),
});

/* ------------------------------------------------------------------ */
/* Mata uang                                                           */
/* ------------------------------------------------------------------ */

const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Kode mata uang harus 3 huruf (ISO 4217), contoh IDR.");

const currencyNameSchema = z
  .string()
  .trim()
  .min(2, "Nama mata uang minimal 2 karakter.")
  .max(100, "Nama mata uang maksimal 100 karakter.");

const currencySymbolSchema = z
  .string()
  .trim()
  .max(10, "Simbol maksimal 10 karakter.")
  .transform(emptyToNull)
  .nullable()
  .optional();

const currencyDecimalsSchema = z
  .number()
  .int("Jumlah desimal harus bilangan bulat.")
  .min(0, "Jumlah desimal minimal 0.")
  .max(6, "Jumlah desimal maksimal 6.");

export const createCurrencySchema = z.strictObject({
  code: currencyCodeSchema,
  name: currencyNameSchema,
  symbol: currencySymbolSchema,
  decimals: currencyDecimalsSchema.default(2),
});

/** Kode mata uang tidak bisa diubah. Mata uang tidak dihapus, hanya dinonaktifkan. */
export const updateCurrencySchema = z
  .strictObject({
    name: currencyNameSchema.optional(),
    symbol: currencySymbolSchema,
    decimals: currencyDecimalsSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine(hasAnyField, atLeastOneField);

export const listCurrenciesQuerySchema = z.strictObject({
  isActive: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

/* ------------------------------------------------------------------ */
/* Kurs                                                                */
/* ------------------------------------------------------------------ */

/**
 * Kurs sebagai string desimal (sesuai numeric(18,6): maksimal 12 digit bulat, 6 desimal),
 * tidak pernah number, supaya tidak melewati floating-point. Harus lebih besar dari nol.
 */
const rateSchema = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,6})?$/, "Kurs harus angka dengan maksimal 6 desimal.")
  .refine((value) => /[1-9]/.test(value), "Kurs harus lebih besar dari nol.");

/**
 * 1 satuan fromCurrency = rate satuan mata uang dasar. Mata uang tujuan (mata uang dasar)
 * diisi oleh service, bukan input. Kurs tidak bisa diubah setelah dibuat.
 */
export const createExchangeRateSchema = z.strictObject({
  fromCurrency: currencyCodeSchema,
  rateDate: dateSchema,
  rate: rateSchema,
  source: z
    .string()
    .trim()
    .max(100, "Sumber maksimal 100 karakter.")
    .transform(emptyToNull)
    .nullable()
    .optional(),
});

export const listExchangeRatesQuerySchema = z
  .strictObject({
    fromCurrency: currencyCodeSchema.optional(),
    dateFrom: dateSchema.optional(),
    dateTo: dateSchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine((value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo, {
    path: ["dateTo"],
    message: "dateTo tidak boleh sebelum dateFrom.",
  });

/* ------------------------------------------------------------------ */
/* Tipe                                                                */
/* ------------------------------------------------------------------ */

export type CreateFiscalYearInput = z.output<typeof createFiscalYearSchema>;
export type ListFiscalYearsQuery = z.output<typeof listFiscalYearsQuerySchema>;
export type ChangePeriodStatusInput = z.output<typeof changePeriodStatusSchema>;
export type CreateCurrencyInput = z.output<typeof createCurrencySchema>;
export type UpdateCurrencyInput = z.output<typeof updateCurrencySchema>;
export type ListCurrenciesQuery = z.output<typeof listCurrenciesQuerySchema>;
export type CreateExchangeRateInput = z.output<typeof createExchangeRateSchema>;
export type ListExchangeRatesQuery = z.output<typeof listExchangeRatesQuerySchema>;