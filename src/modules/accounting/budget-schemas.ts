import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Anggaran (Tahap 4I)                                                 */
/* ------------------------------------------------------------------ */

const uuidSchema = z.uuid("Format ID tidak valid.");

/** Nama anggaran bebas (bukan kode unik); dinormalkan whitespace. */
const nameSchema = z.string().trim().min(2, "Nama minimal 2 karakter.").max(150);

const notesSchema = z
  .string()
  .trim()
  .max(500, "Catatan maksimal 500 karakter.")
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional();

const branchIdSchema = uuidSchema.nullable().optional();

/** Nominal anggaran sebagai string desimal numeric(18,2) (>= 0); tidak pernah number. */
const amountSchema = z
  .string()
  .trim()
  .regex(/^\d{1,16}(\.\d{1,2})?$/, "Nominal maksimal 16 digit bulat dan 2 desimal.");

/** Satu baris anggaran: akun DAUN postable untuk satu periode (bulanan). */
const budgetLineSchema = z.strictObject({
  accountId: uuidSchema,
  periodId: uuidSchema,
  costCenterId: uuidSchema.nullable().optional(),
  amount: amountSchema,
  note: z
    .string()
    .trim()
    .max(200, "Catatan baris maksimal 200 karakter.")
    .nullable()
    .optional(),
});

const budgetLinesSchema = z
  .array(budgetLineSchema)
  .min(1, "Anggaran membutuhkan minimal satu baris.")
  .max(5000, "Terlalu banyak baris anggaran (maksimal 5000).");

export const BUDGET_STATUSES = ["draft", "approved"] as const;
const budgetStatusSchema = z.enum(BUDGET_STATUSES, {
  message: "Status anggaran harus draft atau approved.",
});

export const createBudgetSchema = z.strictObject({
  name: nameSchema,
  fiscalYearId: uuidSchema,
  branchId: branchIdSchema,
  notes: notesSchema,
  lines: budgetLinesSchema,
});

/** Perubahan header anggaran (hanya saat draft). */
export const updateBudgetSchema = z
  .strictObject({
    name: nameSchema.optional(),
    branchId: branchIdSchema,
    notes: notesSchema,
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "Minimal satu field harus diisi.",
  });

/** Mengganti SELURUH baris anggaran (hanya saat draft). */
export const replaceBudgetLinesSchema = z.strictObject({
  lines: budgetLinesSchema,
});

export const listBudgetsQuerySchema = z.strictObject({
  fiscalYearId: uuidSchema.optional(),
  branchId: uuidSchema.optional(),
  status: budgetStatusSchema.optional(),
});

/* ------------------------------- Tipe ------------------------------ */

export type BudgetLineInput = z.output<typeof budgetLineSchema>;
export type CreateBudgetInput = z.output<typeof createBudgetSchema>;
export type UpdateBudgetInput = z.output<typeof updateBudgetSchema>;
export type ReplaceBudgetLinesInput = z.output<typeof replaceBudgetLinesSchema>;
export type ListBudgetsQuery = z.output<typeof listBudgetsQuerySchema>;
