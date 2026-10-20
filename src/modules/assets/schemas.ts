import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Helper                                                              */
/* ------------------------------------------------------------------ */
// Nominal & tarif SELALU string desimal (kolom numeric). Money numeric(18,2),
// rate/persen numeric(9,4). Tidak ada angka bawaan di kode.

const idSchema = z.uuid("Format ID tidak valid.");
const dateSchema = z.iso.date("Tanggal harus berformat YYYY-MM-DD.");

/** Nominal uang: maks 16 digit bulat + 2 desimal (numeric(18,2)). */
const amountSchema = z
  .string()
  .trim()
  .regex(/^\d{1,16}(\.\d{1,2})?$/, "Nominal tidak valid (maks 16 digit, 2 desimal).");

/** Tarif/persen: maks 5 digit bulat + 4 desimal (numeric(9,4)). */
const rateSchema = z
  .string()
  .trim()
  .regex(/^\d{1,5}(\.\d{1,4})?$/, "Tarif tidak valid (maks 5 digit, 4 desimal).");

const intSchema = z.coerce.number().int();
const positiveIntSchema = z.coerce.number().int().min(1);

function codeSchema(label: string) {
  return z
    .string()
    .trim()
    .toUpperCase()
    .min(2, `Kode ${label} minimal 2 karakter.`)
    .max(20, `Kode ${label} maksimal 20 karakter.`)
    .regex(/^[A-Z0-9][A-Z0-9_-]*$/, `Kode ${label} hanya huruf/angka/strip/underscore.`);
}

function nameSchema(label: string) {
  return z
    .string()
    .trim()
    .min(2, `Nama ${label} minimal 2 karakter.`)
    .max(120, `Nama ${label} maksimal 120 karakter.`);
}

const textSchema = (max = 500) => z.string().trim().max(max).nullable().optional();

const isActiveQuery = z
  .enum(["true", "false"])
  .transform((v) => v === "true")
  .optional();

const reasonSchema = z
  .string()
  .trim()
  .min(5, "Alasan minimal 5 karakter.")
  .max(500, "Alasan maksimal 500 karakter.");

const depreciationMethodSchema = z.enum([
  "straight_line",
  "declining_balance",
  "units_of_production",
]);
const assetStatusSchema = z.enum(["draft", "active", "idle", "in_service", "disposed"]);
const fundingSourceSchema = z.enum(["bank", "cash", "payable"]);

/* ---------------------------- Kategori ---------------------------- */

export const createCategorySchema = z.strictObject({
  code: codeSchema("kategori"),
  name: nameSchema("kategori"),
  depreciationMethod: depreciationMethodSchema.default("straight_line"),
  usefulLifeMonths: positiveIntSchema.default(48),
  residualPercent: rateSchema.default("0"),
  decliningRatePercent: rateSchema.nullable().optional(),
  totalUnits: intSchema.nullable().optional(),
  assetCostAccountId: idSchema.nullable().optional(),
  accumulatedDepreciationAccountId: idSchema.nullable().optional(),
  depreciationExpenseAccountId: idSchema.nullable().optional(),
});

export const updateCategorySchema = z
  .strictObject({
    name: nameSchema("kategori").optional(),
    depreciationMethod: depreciationMethodSchema.optional(),
    usefulLifeMonths: positiveIntSchema.optional(),
    residualPercent: rateSchema.optional(),
    decliningRatePercent: rateSchema.nullable().optional(),
    totalUnits: intSchema.nullable().optional(),
    assetCostAccountId: idSchema.nullable().optional(),
    accumulatedDepreciationAccountId: idSchema.nullable().optional(),
    depreciationExpenseAccountId: idSchema.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((f) => f !== undefined), "Minimal satu field diisi.");

export const listCategoriesQuery = z.object({
  isActive: isActiveQuery,
});

/* ---------------------------- Register ---------------------------- */

export const createAssetSchema = z.strictObject({
  code: codeSchema("aset"),
  name: nameSchema("aset"),
  categoryId: idSchema,
  branchId: idSchema.nullable().optional(),
  departmentId: idSchema.nullable().optional(),
  costCenterId: idSchema.nullable().optional(),
  location: textSchema(200),
  inServiceDate: dateSchema,
  cost: amountSchema,
  residualValue: amountSchema.nullable().optional(),
  usefulLifeMonths: positiveIntSchema.nullable().optional(),
  depreciationMethod: depreciationMethodSchema.nullable().optional(),
  decliningRatePercent: rateSchema.nullable().optional(),
  totalUnits: intSchema.nullable().optional(),
  unitsPeriod: positiveIntSchema.nullable().optional(),
  status: assetStatusSchema.default("draft"),
  notes: textSchema(),
});

export const updateAssetSchema = z
  .strictObject({
    name: nameSchema("aset").optional(),
    branchId: idSchema.nullable().optional(),
    departmentId: idSchema.nullable().optional(),
    costCenterId: idSchema.nullable().optional(),
    location: textSchema(200),
    inServiceDate: dateSchema.optional(),
    residualValue: amountSchema.nullable().optional(),
    usefulLifeMonths: positiveIntSchema.nullable().optional(),
    depreciationMethod: depreciationMethodSchema.nullable().optional(),
    decliningRatePercent: rateSchema.nullable().optional(),
    totalUnits: intSchema.nullable().optional(),
    unitsPeriod: positiveIntSchema.nullable().optional(),
    status: assetStatusSchema.optional(),
    isActive: z.boolean().optional(),
    notes: textSchema(),
  })
  .refine((v) => Object.values(v).some((f) => f !== undefined), "Minimal satu field diisi.");

export const listAssetsQuery = z.object({
  categoryId: idSchema.optional(),
  branchId: idSchema.optional(),
  status: assetStatusSchema.optional(),
  isActive: isActiveQuery,
});

/* ----------------------------- Usage ------------------------------ */

export const upsertUsageSchema = z.strictObject({
  periodKey: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}$/, "Periode harus berformat YYYY-MM."),
  units: z.coerce.number().int().min(0, "Pemakaian tidak boleh negatif."),
  notes: textSchema(),
});

/* --------------------------- Akuisisi ----------------------------- */

export const createAcquisitionSchema = z.strictObject({
  assetId: idSchema,
  acquisitionDate: dateSchema,
  amount: amountSchema,
  fundingSource: fundingSourceSchema,
  bankAccountId: idSchema.nullable().optional(),
  notes: textSchema(),
});

export const updateAcquisitionSchema = z
  .strictObject({
    acquisitionDate: dateSchema.optional(),
    amount: amountSchema.optional(),
    fundingSource: fundingSourceSchema.optional(),
    bankAccountId: idSchema.nullable().optional(),
    notes: textSchema(),
  })
  .refine((v) => Object.values(v).some((f) => f !== undefined), "Minimal satu field diisi.");

export const listAcquisitionsQuery = z.object({
  assetId: idSchema.optional(),
  status: z.enum(["draft", "posted", "reversed", "cancelled"]).optional(),
});

/* ---------------------------- Run susut --------------------------- */

export const createRunSchema = z.strictObject({
  periodId: idSchema,
  branchId: idSchema.nullable().optional(),
});

export const listRunsQuery = z.object({
  periodId: idSchema.optional(),
  status: z
    .enum(["draft", "calculated", "approved", "posted", "cancelled", "reversed"])
    .optional(),
});

/* ---------------------------- Transfer ---------------------------- */

export const createTransferSchema = z.strictObject({
  assetId: idSchema,
  transferDate: dateSchema,
  fromBranchId: idSchema.nullable().optional(),
  toBranchId: idSchema.nullable().optional(),
  fromDepartmentId: idSchema.nullable().optional(),
  toDepartmentId: idSchema.nullable().optional(),
  toCostCenterId: idSchema.nullable().optional(),
  notes: textSchema(),
});

/* --------------------------- Perawatan ---------------------------- */

export const createMaintenanceSchema = z.strictObject({
  assetId: idSchema,
  maintenanceDate: dateSchema,
  description: z.string().trim().min(2, "Deskripsi minimal 2 karakter.").max(300),
  vendor: textSchema(120),
  cost: amountSchema.nullable().optional(),
  notes: textSchema(),
});

/* --------------------------- Pelepasan ---------------------------- */

export const createDisposalSchema = z.strictObject({
  assetId: idSchema,
  disposalDate: dateSchema,
  proceedsAmount: amountSchema.default("0"),
  bankAccountId: idSchema.nullable().optional(),
  notes: textSchema(),
});

export const listDisposalsQuery = z.object({
  assetId: idSchema.optional(),
  status: z.enum(["draft", "posted", "reversed", "cancelled"]).optional(),
});

/* --------------------------- Revaluasi ---------------------------- */

export const createRevaluationSchema = z.strictObject({
  assetId: idSchema,
  effectiveDate: dateSchema,
  newCost: amountSchema,
  newAccumulated: amountSchema,
  notes: textSchema(),
});

/* ----------------------------- Reason ----------------------------- */

export const reasonInputSchema = z.strictObject({ reason: reasonSchema });

/* ------------------------------ Tipe ------------------------------ */

export type CreateCategoryInput = z.output<typeof createCategorySchema>;
export type UpdateCategoryInput = z.output<typeof updateCategorySchema>;
export type CreateAssetInput = z.output<typeof createAssetSchema>;
export type UpdateAssetInput = z.output<typeof updateAssetSchema>;
export type UpsertUsageInput = z.output<typeof upsertUsageSchema>;
export type CreateAcquisitionInput = z.output<typeof createAcquisitionSchema>;
export type UpdateAcquisitionInput = z.output<typeof updateAcquisitionSchema>;
export type CreateRunInput = z.output<typeof createRunSchema>;
export type CreateTransferInput = z.output<typeof createTransferSchema>;
export type CreateMaintenanceInput = z.output<typeof createMaintenanceSchema>;
export type CreateDisposalInput = z.output<typeof createDisposalSchema>;
export type CreateRevaluationInput = z.output<typeof createRevaluationSchema>;
