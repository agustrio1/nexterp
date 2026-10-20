import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Kas & bank (Tahap 4H)                                               */
/* ------------------------------------------------------------------ */

const uuidSchema = z.uuid("Format ID tidak valid.");
const dateSchema = z.iso.date("Tanggal harus berformat YYYY-MM-DD.");

/** Format kode sama dengan COA/pusat biaya; dinormalkan ke kapital. */
const codeSchema = z
  .string()
  .trim()
  .min(2, "Kode minimal 2 karakter.")
  .max(30, "Kode maksimal 30 karakter.")
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9.-]*$/,
    "Kode hanya boleh huruf, angka, titik, dan strip; harus diawali huruf atau angka.",
  )
  .transform((value) => value.toUpperCase());

const nameSchema = z.string().trim().min(2, "Nama minimal 2 karakter.").max(150);

const descriptionSchema = z
  .string()
  .trim()
  .max(500, "Deskripsi maksimal 500 karakter.")
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional();

const branchIdSchema = uuidSchema.nullable().optional();

/** Nominal kas sebagai string desimal numeric(18,2) (> 0); tidak pernah number. */
const amountSchema = z
  .string()
  .trim()
  .regex(/^\d{1,16}(\.\d{1,2})?$/, "Nominal maksimal 16 digit bulat dan 2 desimal.")
  .refine((value) => /[1-9]/.test(value.replace(".", "")), "Nominal harus lebih dari nol.");

/* --------------------------- Bank accounts ------------------------- */

export const BANK_ACCOUNT_KINDS = ["cash", "bank"] as const;
const bankKindSchema = z.enum(BANK_ACCOUNT_KINDS, {
  message: "Jenis rekening harus cash atau bank.",
});

export const createBankAccountSchema = z.strictObject({
  code: codeSchema,
  name: nameSchema,
  accountId: uuidSchema,
  kind: bankKindSchema,
  bankName: z.string().trim().max(150).optional(),
  accountNumber: z.string().trim().max(64).optional(),
  branchId: branchIdSchema,
  description: descriptionSchema,
});

export const updateBankAccountSchema = z
  .strictObject({
    name: nameSchema.optional(),
    accountId: uuidSchema.optional(),
    kind: bankKindSchema.optional(),
    bankName: z.string().trim().max(150).nullable().optional(),
    accountNumber: z.string().trim().max(64).nullable().optional(),
    branchId: branchIdSchema,
    isActive: z.boolean().optional(),
    description: descriptionSchema,
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "Minimal satu field harus diisi.",
  });

export const listBankAccountsQuerySchema = z.strictObject({
  isActive: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  kind: bankKindSchema.optional(),
  branchId: uuidSchema.optional(),
});

/* ------------------------- Cash transactions ----------------------- */

export const CASH_TRANSACTION_TYPES = ["receipt", "disbursement", "transfer"] as const;
const cashTypeSchema = z.enum(CASH_TRANSACTION_TYPES, {
  message: "Jenis transaksi harus receipt/disbursement/transfer.",
});

/**
 * Draf transaksi kas/bank. Kontrapost ditentukan `type`:
 * - receipt/disbursement: `contraAccountId` wajib (akun GL lawan).
 * - transfer: `counterpartBankAccountId` wajib (rekening tujuan), berbeda dari asal.
 */
export const createCashTransactionSchema = z
  .strictObject({
    transactionDate: dateSchema,
    type: cashTypeSchema,
    bankAccountId: uuidSchema,
    contraAccountId: uuidSchema.optional(),
    counterpartBankAccountId: uuidSchema.optional(),
    amount: amountSchema,
    branchId: branchIdSchema,
    costCenterId: uuidSchema.nullable().optional(),
    description: z.string().trim().min(3, "Deskripsi minimal 3 karakter.").max(500),
    reference: z
      .string()
      .trim()
      .max(50, "Referensi maksimal 50 karakter.")
      .transform((value) => (value === "" ? null : value))
      .nullable()
      .optional(),
    idempotencyKey: z
      .string()
      .trim()
      .min(8, "idempotencyKey minimal 8 karakter.")
      .max(200, "idempotencyKey maksimal 200 karakter.")
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === "transfer") {
      if (!value.counterpartBankAccountId) {
        ctx.addIssue({
          code: "custom",
          path: ["counterpartBankAccountId"],
          message: "Transfer membutuhkan rekening tujuan.",
        });
      } else if (value.counterpartBankAccountId === value.bankAccountId) {
        ctx.addIssue({
          code: "custom",
          path: ["counterpartBankAccountId"],
          message: "Rekening tujuan transfer harus berbeda dari rekening asal.",
        });
      }
    } else if (!value.contraAccountId) {
      ctx.addIssue({
        code: "custom",
        path: ["contraAccountId"],
        message: "Penerimaan/pengeluaran membutuhkan akun lawan.",
      });
    }
  });

export const cancelCashTransactionSchema = z.strictObject({
  reason: z.string().trim().min(5, "Alasan minimal 5 karakter.").max(500),
});

export const reverseCashTransactionSchema = z.strictObject({
  reason: z.string().trim().min(5, "Alasan minimal 5 karakter.").max(500),
  entryDate: dateSchema.optional(),
});

export const listCashTransactionsQuerySchema = z
  .strictObject({
    bankAccountId: uuidSchema.optional(),
    type: cashTypeSchema.optional(),
    status: z.enum(["draft", "posted", "reversed", "cancelled"]).optional(),
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

export type CreateBankAccountInput = z.output<typeof createBankAccountSchema>;
export type UpdateBankAccountInput = z.output<typeof updateBankAccountSchema>;
export type ListBankAccountsQuery = z.output<typeof listBankAccountsQuerySchema>;

export type CreateCashTransactionInput = z.output<typeof createCashTransactionSchema>;
export type CancelCashTransactionInput = z.output<typeof cancelCashTransactionSchema>;
export type ReverseCashTransactionInput = z.output<typeof reverseCashTransactionSchema>;
export type ListCashTransactionsQuery = z.output<typeof listCashTransactionsQuerySchema>;
