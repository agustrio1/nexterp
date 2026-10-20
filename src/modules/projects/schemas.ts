import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Helper                                                              */
/* ------------------------------------------------------------------ */
// Nominal & persen SELALU string desimal (kolom numeric). Mirror pola assets.

const idSchema = z.uuid("Format ID tidak valid.");
const dateSchema = z.iso.date("Tanggal harus berformat YYYY-MM-DD.");

const amountSchema = z
  .string()
  .trim()
  .regex(/^\d{1,16}(\.\d{1,2})?$/, "Nominal tidak valid (maks 16 digit, 2 desimal).");

const rateSchema = z
  .string()
  .trim()
  .regex(/^\d{1,5}(\.\d{1,4})?$/, "Tarif tidak valid (maks 5 digit, 4 desimal).");

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

const projectStatusSchema = z.enum(["planning", "in_progress", "on_hold", "completed", "cancelled"]);
const taskStatusSchema = z.enum(["pending", "in_progress", "completed", "cancelled"]);

/* ----------------------------- Proyek ----------------------------- */

/**
 * Buat proyek. Mode taut: isi `costCenterId` (harus aktif & belum ditautkan).
 * Mode auto: tanpa `costCenterId` -> service membuat cost center anak
 * (kode = kode proyek) lewat cost-center-service (butuh izin
 * accounting.cost_centers.manage pada aktor).
 */
export const createProjectSchema = z.strictObject({
  code: codeSchema("proyek"),
  name: nameSchema("proyek"),
  description: textSchema(),
  costCenterId: idSchema.nullable().optional(),
  branchId: idSchema.nullable().optional(),
  managerEmployeeId: idSchema.nullable().optional(),
  startDate: dateSchema,
  endDate: dateSchema.nullable().optional(),
  totalBudget: amountSchema.nullable().optional(),
  status: projectStatusSchema.default("planning"),
});

export const updateProjectSchema = z
  .strictObject({
    name: nameSchema("proyek").optional(),
    description: textSchema(),
    branchId: idSchema.nullable().optional(),
    managerEmployeeId: idSchema.nullable().optional(),
    startDate: dateSchema.optional(),
    endDate: dateSchema.nullable().optional(),
    totalBudget: amountSchema.nullable().optional(),
    status: projectStatusSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((f) => f !== undefined), "Minimal satu field diisi.");

export const listProjectsQuery = z.object({
  status: projectStatusSchema.optional(),
  branchId: idSchema.optional(),
  isActive: isActiveQuery,
});

/** Perbarui progres: `progressPercent` eksplisit ATAU otomatis dari bobot tugas (tanpa field). */
export const updateProgressSchema = z.strictObject({
  progressPercent: rateSchema.optional(),
});

/* ------------------------------ Tugas ----------------------------- */

export const createTaskSchema = z.strictObject({
  name: nameSchema("tugas"),
  assigneeEmployeeId: idSchema.nullable().optional(),
  sortOrder: positiveIntSchema.default(1),
  weightPercent: rateSchema.default("0"),
  dueDate: dateSchema.nullable().optional(),
  notes: textSchema(),
});

export const updateTaskSchema = z
  .strictObject({
    name: nameSchema("tugas").optional(),
    assigneeEmployeeId: idSchema.nullable().optional(),
    status: taskStatusSchema.optional(),
    sortOrder: positiveIntSchema.optional(),
    weightPercent: rateSchema.optional(),
    dueDate: dateSchema.nullable().optional(),
    notes: textSchema(),
  })
  .refine((v) => Object.values(v).some((f) => f !== undefined), "Minimal satu field diisi.");

/* ---------------------------- Milestone --------------------------- */

export const createMilestoneSchema = z.strictObject({
  name: nameSchema("milestone"),
  dueDate: dateSchema.nullable().optional(),
  notes: textSchema(),
});

export const updateMilestoneSchema = z
  .strictObject({
    name: nameSchema("milestone").optional(),
    dueDate: dateSchema.nullable().optional(),
    isCompleted: z.boolean().optional(),
    notes: textSchema(),
  })
  .refine((v) => Object.values(v).some((f) => f !== undefined), "Minimal satu field diisi.");

/* ---------------------------- Penugasan --------------------------- */

export const createAssignmentSchema = z.strictObject({
  employeeId: idSchema,
  role: z.string().trim().min(2, "Peran minimal 2 karakter.").max(60),
});

/* ----------------------------- Anggaran ---------------------------- */

export const createProjectBudgetSchema = z.strictObject({
  accountId: idSchema.nullable().optional(),
  periodKey: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}$/, "Periode harus berformat YYYY-MM.")
    .nullable()
    .optional(),
  amount: amountSchema,
  notes: textSchema(),
});

export const updateProjectBudgetSchema = z
  .strictObject({
    accountId: idSchema.nullable().optional(),
    periodKey: createProjectBudgetSchema.shape.periodKey,
    amount: amountSchema.optional(),
    notes: textSchema(),
  })
  .refine((v) => Object.values(v).some((f) => f !== undefined), "Minimal satu field diisi.");

/* ------------------------------ Tipe ------------------------------ */

// Tipe ter-parse (z.output) — sama persis dengan pola modules/assets: rute API
// mem-parse body (default terisi) lalu meneruskan ke service; pemanggil langsung
// (mis. skrip uji rollback) WAJIB mengisi field ber-default secara eksplisit.
export type CreateProjectInput = z.output<typeof createProjectSchema>;
export type UpdateProjectInput = z.output<typeof updateProjectSchema>;
export type UpdateProgressInput = z.output<typeof updateProgressSchema>;
export type CreateTaskInput = z.output<typeof createTaskSchema>;
export type UpdateTaskInput = z.output<typeof updateTaskSchema>;
export type CreateMilestoneInput = z.output<typeof createMilestoneSchema>;
export type UpdateMilestoneInput = z.output<typeof updateMilestoneSchema>;
export type CreateAssignmentInput = z.output<typeof createAssignmentSchema>;
export type CreateProjectBudgetInput = z.output<typeof createProjectBudgetSchema>;
export type UpdateProjectBudgetInput = z.output<typeof updateProjectBudgetSchema>;
