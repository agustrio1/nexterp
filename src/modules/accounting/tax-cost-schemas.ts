import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Pusat biaya, pajak, dan transaksi pajak (Tahap 4G)                   */
/* ------------------------------------------------------------------ */

const uuidSchema = z.uuid("Format ID tidak valid.");
const dateSchema = z.iso.date("Tanggal harus berformat YYYY-MM-DD.");

/** Format kode sama dengan COA: diawali huruf/angka, boleh titik/strip; dinormalkan ke kapital. */
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

/* ----------------------------- Cost centers ------------------------ */

export const createCostCenterSchema = z.strictObject({
  code: codeSchema,
  name: nameSchema,
  parentId: uuidSchema.nullable().optional(),
  branchId: branchIdSchema,
  description: descriptionSchema,
});

export const updateCostCenterSchema = z
  .strictObject({
    name: nameSchema.optional(),
    parentId: uuidSchema.nullable().optional(),
    branchId: branchIdSchema,
    isActive: z.boolean().optional(),
    description: descriptionSchema,
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "Minimal satu field harus diisi.",
  });

export const listCostCentersQuerySchema = z.strictObject({
  isActive: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  branchId: uuidSchema.optional(),
});

/* -------------------------------- Taxes ---------------------------- */

export const TAX_KINDS = ["output", "input", "withholding"] as const;
const taxKindSchema = z.enum(TAX_KINDS, {
  message: "Jenis pajak harus output/input/withholding.",
});

export const createTaxSchema = z.strictObject({
  code: codeSchema,
  name: nameSchema,
  kind: taxKindSchema,
  taxAccountId: uuidSchema,
  description: descriptionSchema,
});

export const updateTaxSchema = z
  .strictObject({
    name: nameSchema.optional(),
    kind: taxKindSchema.optional(),
    taxAccountId: uuidSchema.optional(),
    isActive: z.boolean().optional(),
    description: descriptionSchema,
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "Minimal satu field harus diisi.",
  });

export const listTaxesQuerySchema = z.strictObject({
  isActive: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  kind: taxKindSchema.optional(),
});

/* ------------------------------ Tax rates -------------------------- */

/**
 * Tarif persen: maksimal 5 digit bulat + 4 desimal, 0..100. Disimpan persis
 * seperti kolom numeric(9,4). Nilai diisi operator dari sumber resmi — sistem
 * tidak pernah menghasilkan tarif sendiri.
 */
const rateSchema = z
  .string()
  .trim()
  .regex(/^\d{1,5}(\.\d{1,4})?$/, "Tarif maksimal 5 digit bulat dan 4 desimal.")
  .refine((value) => Number(value) >= 0 && Number(value) <= 100, "Tarif harus 0..100.");

const sourceSchema = z.string().trim().min(3, "Sumber resmi wajib diisi.").max(300);

export const createTaxRateSchema = z.strictObject({
  rate: rateSchema,
  effectiveFrom: dateSchema,
  source: sourceSchema,
  note: descriptionSchema,
});

/* -------------------------- Tax transactions ----------------------- */

/** Nominal dasar pajak sebagai string desimal numeric(18,2); >= 0. */
const baseAmountSchema = z
  .string()
  .trim()
  .regex(/^\d{1,16}(\.\d{1,2})?$/, "Nominal maksimal 16 digit bulat dan 2 desimal.");

export const TAX_DIRECTIONS = ["collect", "pay"] as const;
const taxDirectionSchema = z.enum(TAX_DIRECTIONS, {
  message: "Arah transaksi pajak harus collect atau pay.",
});

export const createTaxTransactionSchema = z.strictObject({
  taxId: uuidSchema,
  transactionDate: dateSchema,
  direction: taxDirectionSchema,
  baseAmount: baseAmountSchema,
  branchId: branchIdSchema,
  costCenterId: uuidSchema.nullable().optional(),
  journalEntryId: uuidSchema.nullable().optional(),
  notes: descriptionSchema,
});

export const listTaxTransactionsQuerySchema = z
  .strictObject({
    taxId: uuidSchema.optional(),
    direction: taxDirectionSchema.optional(),
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

export type CreateCostCenterInput = z.output<typeof createCostCenterSchema>;
export type UpdateCostCenterInput = z.output<typeof updateCostCenterSchema>;
export type ListCostCentersQuery = z.output<typeof listCostCentersQuerySchema>;

export type CreateTaxInput = z.output<typeof createTaxSchema>;
export type UpdateTaxInput = z.output<typeof updateTaxSchema>;
export type ListTaxesQuery = z.output<typeof listTaxesQuerySchema>;

export type CreateTaxRateInput = z.output<typeof createTaxRateSchema>;

export type CreateTaxTransactionInput = z.output<typeof createTaxTransactionSchema>;
export type ListTaxTransactionsQuery = z.output<typeof listTaxTransactionsQuerySchema>;
