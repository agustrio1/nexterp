import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Rekonsiliasi bank (Tahap 4H-C)                                      */
/* ------------------------------------------------------------------ */

const uuidSchema = z.uuid("Format ID tidak valid.");
const dateSchema = z.iso.date("Tanggal harus berformat YYYY-MM-DD.");

/** Nominal statement/saldo: string desimal numeric(18,2), boleh bernilai negatif (overdraw). */
const balanceSchema = z
  .string()
  .trim()
  .regex(/^-?\d{1,16}(\.\d{1,2})?$/, "Nominal maksimal 16 digit bulat dan 2 desimal.");

/** Nominal mutasi (amount) harus > 0; tanda dibawa oleh kolom direction. */
const amountSchema = z
  .string()
  .trim()
  .regex(/^\d{1,16}(\.\d{1,2})?$/, "Nominal maksimal 16 digit bulat dan 2 desimal.")
  .refine((value) => /[1-9]/.test(value.replace(".", "")), "Nominal harus lebih dari nol.");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional();

const matchedFlagSchema = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

/* -------------------------- Statement lines ------------------------ */

export const BANK_STATEMENT_DIRECTIONS = ["in", "out"] as const;
const directionSchema = z.enum(BANK_STATEMENT_DIRECTIONS, {
  message: "Arah mutasi harus in atau out.",
});

const statementLineSchema = z.strictObject({
  statementDate: dateSchema,
  description: z.string().trim().min(1, "Deskripsi wajib diisi.").max(500),
  reference: optionalText(50),
  direction: directionSchema,
  amount: amountSchema,
  bookBalanceAfter: balanceSchema.optional(),
});

export const importBankStatementSchema = z
  .strictObject({
    bankAccountId: uuidSchema,
    lines: z
      .array(statementLineSchema)
      .min(1, "Impor membutuhkan minimal satu baris.")
      .max(5000, "Terlalu banyak baris (maksimal 5000)."),
  })
  .refine(
    (value) => {
      const seen = new Set<string>();
      for (const line of value.lines) {
        const key = `${line.statementDate}|${line.direction}|${line.amount}|${line.reference ?? ""}|${line.description}`;
        if (seen.has(key)) return false;
        seen.add(key);
      }
      return true;
    },
    { message: "Terdapat baris identik (tanggal+arah+nominal+referensi+deskripsi) dalam satu impor." },
  );

export const setStatementLineMatchSchema = z.strictObject({
  cashTransactionId: uuidSchema.nullable(),
});

export const listBankStatementLinesQuerySchema = z
  .strictObject({
    bankAccountId: uuidSchema.optional(),
    reconciliationId: uuidSchema.optional(),
    matched: matchedFlagSchema.optional(),
    dateFrom: dateSchema.optional(),
    dateTo: dateSchema.optional(),
    limit: z
      .string()
      .regex(/^\d+$/, "limit harus berupa bilangan bulat.")
      .transform(Number)
      .pipe(z.number().int().min(1).max(500))
      .optional(),
    cursor: z.string().min(1).max(500).optional(),
  })
  .refine((value) => !value.dateFrom || !value.dateTo || value.dateTo >= value.dateFrom, {
    path: ["dateTo"],
    message: "dateTo tidak boleh sebelum dateFrom.",
  });

/* --------------------------- Reconciliations ----------------------- */

export const BANK_RECONCILIATION_STATUSES = ["draft", "final"] as const;
const reconciliationStatusSchema = z.enum(BANK_RECONCILIATION_STATUSES, {
  message: "Status rekonsiliasi harus draft atau final.",
});

export const createBankReconciliationSchema = z
  .strictObject({
    bankAccountId: uuidSchema,
    startDate: dateSchema,
    endDate: dateSchema,
    statementOpeningBalance: balanceSchema,
    statementClosingBalance: balanceSchema,
    notes: optionalText(500),
    autoMatch: z.boolean().optional(),
    toleranceDays: z
      .number()
      .int()
      .min(0)
      .max(30)
      .optional(),
  })
  .refine((value) => value.endDate >= value.startDate, {
    path: ["endDate"],
    message: "endDate tidak boleh sebelum startDate.",
  });

export const autoMatchReconciliationSchema = z.strictObject({
  toleranceDays: z.number().int().min(0).max(30).optional(),
});

export const listBankReconciliationsQuerySchema = z
  .strictObject({
    bankAccountId: uuidSchema.optional(),
    status: reconciliationStatusSchema.optional(),
    dateFrom: dateSchema.optional(),
    dateTo: dateSchema.optional(),
    limit: z
      .string()
      .regex(/^\d+$/, "limit harus berupa bilangan bulat.")
      .transform(Number)
      .pipe(z.number().int().min(1).max(200))
      .optional(),
    cursor: z.string().min(1).max(500).optional(),
  })
  .refine((value) => !value.dateFrom || !value.dateTo || value.dateTo >= value.dateFrom, {
    path: ["dateTo"],
    message: "dateTo tidak boleh sebelum dateFrom.",
  });

/* ------------------------------- Tipe ------------------------------ */

export type StatementLineInput = z.output<typeof statementLineSchema>;
export type ImportBankStatementInput = z.output<typeof importBankStatementSchema>;
export type SetStatementLineMatchInput = z.output<typeof setStatementLineMatchSchema>;
export type ListBankStatementLinesQuery = z.output<typeof listBankStatementLinesQuerySchema>;

export type CreateBankReconciliationInput = z.output<typeof createBankReconciliationSchema>;
export type AutoMatchReconciliationInput = z.output<typeof autoMatchReconciliationSchema>;
export type ListBankReconciliationsQuery = z.output<typeof listBankReconciliationsQuerySchema>;
