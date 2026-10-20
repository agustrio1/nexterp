import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Helper                                                              */
/* ------------------------------------------------------------------ */
// Nominal & tarif SELALU string desimal (kolom numeric). Tidak ada angka
// regulasi bawaan — tarif statutory datang dari data (statutory_rules).

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

const notesSchema = z.string().trim().max(500, "Catatan maksimal 500 karakter.").nullable().optional();

const isActiveQuery = z
  .enum(["true", "false"])
  .transform((v) => v === "true")
  .optional();

const sourceSchema = z
  .string()
  .trim()
  .min(3, "Sumber regulasi minimal 3 karakter.")
  .max(200, "Sumber regulasi maksimal 200 karakter.");

const payFrequencySchema = z.enum(["monthly", "bimonthly", "weekly"]);
const componentKindSchema = z.enum(["earning", "deduction"]);
const componentBasisSchema = z.enum(["fixed", "percentage_of_base", "statutory", "attendance"]);
const statutoryKindSchema = z.enum([
  "pph21",
  "bpjs_kesehatan",
  "bpjs_jht",
  "bpjs_jp",
  "bpjs_kk",
  "bpjs_jkm",
  "other",
]);
const partyShareSchema = z.enum(["employee", "employer", "both"]);

/* --------------------------- Struktur gaji ------------------------- */

export const createStructureSchema = z.strictObject({
  code: codeSchema("struktur"),
  name: nameSchema("struktur"),
  payFrequency: payFrequencySchema.default("monthly"),
});

export const updateStructureSchema = z
  .strictObject({
    name: nameSchema("struktur").optional(),
    payFrequency: payFrequencySchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((f) => f !== undefined), "Minimal satu field diisi.");

/** Lampiskan/lepas keanggotaan komponen pada struktur. */
export const attachComponentsSchema = z.strictObject({
  componentIds: z.array(idSchema).min(1, "Pilih minimal satu komponen.").max(200),
});

/* --------------------------- Komponen gaji ------------------------- */

export const createComponentSchema = z.strictObject({
  code: codeSchema("komponen"),
  name: nameSchema("komponen"),
  kind: componentKindSchema,
  basis: componentBasisSchema,
  statutoryKind: statutoryKindSchema.nullable().optional(),
  orderNo: intSchema.min(1).max(999).optional(),
  includeInTaxBase: z.boolean().default(false),
  includeInBpjsBase: z.boolean().default(false),
});

export const updateComponentSchema = z
  .strictObject({
    name: nameSchema("komponen").optional(),
    kind: componentKindSchema.optional(),
    basis: componentBasisSchema.optional(),
    statutoryKind: statutoryKindSchema.nullable().optional(),
    orderNo: intSchema.min(1).max(999).optional(),
    includeInTaxBase: z.boolean().optional(),
    includeInBpjsBase: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((f) => f !== undefined), "Minimal satu field diisi.");

/* --------------------------- Statutory ----------------------------- */

export const createStatutoryRuleSchema = z.strictObject({
  code: codeSchema("aturan"),
  kind: statutoryKindSchema,
  party: partyShareSchema,
  name: nameSchema("aturan"),
  rate: rateSchema.nullable().optional(),
  flatAmount: amountSchema.nullable().optional(),
  wageCap: amountSchema.nullable().optional(),
  belowWageCap: z.boolean().nullable().optional(),
  source: sourceSchema,
  effectiveFrom: dateSchema,
  notes: notesSchema,
});

export const updateStatutoryRuleSchema = z
  .strictObject({
    kind: statutoryKindSchema.optional(),
    party: partyShareSchema.optional(),
    name: nameSchema("aturan").optional(),
    rate: rateSchema.nullable().optional(),
    flatAmount: amountSchema.nullable().optional(),
    wageCap: amountSchema.nullable().optional(),
    belowWageCap: z.boolean().nullable().optional(),
    source: sourceSchema.optional(),
    isActive: z.boolean().optional(),
    notes: notesSchema,
  })
  .refine((v) => Object.values(v).some((f) => f !== undefined), "Minimal satu field diisi.");

export const createBracketSchema = z.strictObject({
  orderNo: intSchema.min(1).max(999),
  minAmount: amountSchema,
  maxAmount: amountSchema.nullable().optional(),
  rate: rateSchema,
  source: sourceSchema,
});

export const updateBracketSchema = z
  .strictObject({
    minAmount: amountSchema.optional(),
    maxAmount: amountSchema.nullable().optional(),
    rate: rateSchema.optional(),
    source: sourceSchema.optional(),
  })
  .refine((v) => Object.values(v).some((f) => f !== undefined), "Minimal satu field diisi.");

/* --------------------------- Periode ------------------------------- */

export const createPeriodSchema = z.strictObject({
  code: codeSchema("periode"),
  name: nameSchema("periode"),
  periodStart: dateSchema,
  periodEnd: dateSchema,
  branchId: idSchema.nullable().optional(),
});

export const updatePeriodSchema = z
  .strictObject({
    name: nameSchema("periode").optional(),
    branchId: idSchema.nullable().optional(),
  })
  .refine((v) => Object.values(v).some((f) => f !== undefined), "Minimal satu field diisi.");

/* --------------------- Kompensasi & nilai komponen ----------------- */

export const setCompensationSchema = z.strictObject({
  employeeId: idSchema,
  structureId: idSchema.nullable().optional(),
  baseSalary: amountSchema,
  effectiveFrom: dateSchema,
});

export const setComponentValueSchema = z.strictObject({
  employeeId: idSchema,
  componentId: idSchema,
  amount: amountSchema.nullable().optional(),
  percentValue: rateSchema.nullable().optional(),
  effectiveFrom: dateSchema,
});

export const createAdjustmentSchema = z.strictObject({
  employeeId: idSchema,
  periodId: idSchema.nullable().optional(),
  componentId: idSchema.nullable().optional(),
  kind: componentKindSchema,
  amount: amountSchema,
  effectiveFrom: dateSchema,
  notes: notesSchema,
});

export const updateAdjustmentSchema = z
  .strictObject({
    amount: amountSchema.optional(),
    isActive: z.boolean().optional(),
    notes: notesSchema,
  })
  .refine((v) => Object.values(v).some((f) => f !== undefined), "Minimal satu field diisi.");

/* ------------------------------ Run -------------------------------- */

export const createRunSchema = z.strictObject({
  periodId: idSchema,
  branchId: idSchema.nullable().optional(),
});

export const listRunsQuerySchema = z.strictObject({
  periodId: idSchema.optional(),
  status: z.enum(["draft", "calculated", "approved", "posted", "cancelled", "reversed"]).optional(),
});

/* --------------------------- Pembaca/list -------------------------- */

export const listStructuresQuerySchema = z.strictObject({ isActive: isActiveQuery });
export const listComponentsQuerySchema = z.strictObject({
  isActive: isActiveQuery,
  kind: componentKindSchema.optional(),
});
export const listStatutoryQuerySchema = z.strictObject({
  isActive: isActiveQuery,
  kind: statutoryKindSchema.optional(),
});
export const listPeriodsQuerySchema = z.strictObject({
  status: z.enum(["draft", "finalized", "posted", "closed"]).optional(),
});
export const listAdjustmentsQuerySchema = z.strictObject({
  employeeId: idSchema.optional(),
  periodId: idSchema.optional(),
});

/* ------------------------------ Tipe ------------------------------- */

export type CreateStructureInput = z.output<typeof createStructureSchema>;
export type UpdateStructureInput = z.output<typeof updateStructureSchema>;
export type AttachComponentsInput = z.output<typeof attachComponentsSchema>;
export type CreateComponentInput = z.output<typeof createComponentSchema>;
export type UpdateComponentInput = z.output<typeof updateComponentSchema>;
export type CreateStatutoryRuleInput = z.output<typeof createStatutoryRuleSchema>;
export type UpdateStatutoryRuleInput = z.output<typeof updateStatutoryRuleSchema>;
export type CreateBracketInput = z.output<typeof createBracketSchema>;
export type UpdateBracketInput = z.output<typeof updateBracketSchema>;
export type CreatePeriodInput = z.output<typeof createPeriodSchema>;
export type UpdatePeriodInput = z.output<typeof updatePeriodSchema>;
export type SetCompensationInput = z.output<typeof setCompensationSchema>;
export type SetComponentValueInput = z.output<typeof setComponentValueSchema>;
export type CreateAdjustmentInput = z.output<typeof createAdjustmentSchema>;
export type UpdateAdjustmentInput = z.output<typeof updateAdjustmentSchema>;
export type CreateRunInput = z.output<typeof createRunSchema>;
export type ListRunsQuery = z.output<typeof listRunsQuerySchema>;
