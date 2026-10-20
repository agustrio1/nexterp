import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Helper                                                              */
/* ------------------------------------------------------------------ */

const idSchema = z.uuid("Format ID tidak valid.");
const dateSchema = z.iso.date("Tanggal harus berformat YYYY-MM-DD.");
const datetimeSchema = z.iso.datetime("Waktu harus ISO-8601 dengan zona waktu.");
const decimalSchema = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Angka desimal tidak valid (maks 2 desimal).");
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

const optionalText = (max: number, label: string) =>
  z.string().trim().max(max, `${label} maksimal ${max} karakter.`).nullable().optional();

const emailSchema = z
  .string()
  .trim()
  .max(254, "Email maksimal 254 karakter.")
  .nullable()
  .transform((v) => (v === "" ? null : v))
  .refine((v) => v === null || z.email().safeParse(v).success, "Format email tidak valid.")
  .optional();

const isActiveQuery = z
  .enum(["true", "false"])
  .transform((v) => v === "true")
  .optional();

/* --------------------------- Jabatan ------------------------------ */

export const createPositionSchema = z.strictObject({
  code: codeSchema("jabatan"),
  name: nameSchema("jabatan"),
  departmentId: idSchema.nullable().optional(),
  jobGrade: intSchema.min(0).nullable().optional(),
});

export const updatePositionSchema = z
  .strictObject({
    name: nameSchema("jabatan").optional(),
    departmentId: idSchema.nullable().optional(),
    jobGrade: intSchema.min(0).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((f) => f !== undefined), "Minimal satu field diisi.");

export const listPositionsQuerySchema = z.strictObject({
  isActive: isActiveQuery,
  departmentId: idSchema.optional(),
});

/* --------------------------- Karyawan ----------------------------- */

const employeeStatusSchema = z.enum(["probation", "active", "on_leave", "inactive", "terminated"]);

export const createEmployeeSchema = z.strictObject({
  code: codeSchema("karyawan"),
  userId: idSchema.nullable().optional(),
  firstName: z.string().trim().min(1, "Nama depan wajib diisi.").max(100),
  lastName: optionalText(100, "Nama belakang"),
  birthDate: dateSchema.nullable().optional(),
  gender: optionalText(20, "Jenis kelamin"),
  npwp: optionalText(30, "NPWP"),
  address: optionalText(500, "Alamat"),
  phone: optionalText(30, "Telepon"),
  email: emailSchema,
  departmentId: idSchema.nullable().optional(),
  positionId: idSchema.nullable().optional(),
  branchId: idSchema.nullable().optional(),
  managerId: idSchema.nullable().optional(),
  dateJoined: dateSchema,
  status: employeeStatusSchema.optional(),
});

export const updateEmployeeSchema = z
  .strictObject({
    userId: idSchema.nullable().optional(),
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: optionalText(100, "Nama belakang"),
    birthDate: dateSchema.nullable().optional(),
    gender: optionalText(20, "Jenis kelamin"),
    npwp: optionalText(30, "NPWP"),
    address: optionalText(500, "Alamat"),
    phone: optionalText(30, "Telepon"),
    email: emailSchema,
    departmentId: idSchema.nullable().optional(),
    positionId: idSchema.nullable().optional(),
    branchId: idSchema.nullable().optional(),
    managerId: idSchema.nullable().optional(),
    status: employeeStatusSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((f) => f !== undefined), "Minimal satu field diisi.");

export const listEmployeesQuerySchema = z.strictObject({
  isActive: isActiveQuery,
  departmentId: idSchema.optional(),
  branchId: idSchema.optional(),
  status: employeeStatusSchema.optional(),
});

/* --------------------------- Dokumen ------------------------------ */

const documentCategorySchema = z.enum(["identity", "academic", "contract", "tax", "other"]);

export const createDocumentSchema = z.strictObject({
  employeeId: idSchema,
  category: documentCategorySchema,
  name: z.string().trim().min(1, "Nama dokumen wajib diisi.").max(200),
  externalRef: optionalText(200, "Referensi"),
  notes: optionalText(2000, "Catatan"),
  capturedAt: datetimeSchema.optional(),
});

export const updateDocumentSchema = z
  .strictObject({
    category: documentCategorySchema.optional(),
    name: z.string().trim().min(1).max(200).optional(),
    externalRef: optionalText(200, "Referensi"),
    notes: optionalText(2000, "Catatan"),
  })
  .refine((v) => Object.values(v).some((f) => f !== undefined), "Minimal satu field diisi.");

/* ---------------------------- Kontrak ----------------------------- */

const contractTypeSchema = z.enum(["pkwt", "pkwtt", "outsourcing", "intern"]);
const contractStatusSchema = z.enum(["draft", "active", "ended", "cancelled"]);

export const createContractSchema = z.strictObject({
  employeeId: idSchema,
  code: codeSchema("kontrak"),
  type: contractTypeSchema,
  startDate: dateSchema,
  endDate: dateSchema.nullable().optional(),
  status: contractStatusSchema.optional(),
  notes: optionalText(2000, "Catatan"),
});

export const updateContractSchema = z
  .strictObject({
    type: contractTypeSchema.optional(),
    startDate: dateSchema.optional(),
    endDate: dateSchema.nullable().optional(),
    status: contractStatusSchema.optional(),
    notes: optionalText(2000, "Catatan"),
  })
  .refine((v) => Object.values(v).some((f) => f !== undefined), "Minimal satu field diisi.");

/* ---------------------------- Shift ------------------------------- */

const timeSchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Waktu harus HH:MM atau HH:MM:SS.");

export const createShiftSchema = z.strictObject({
  code: codeSchema("shift"),
  name: nameSchema("shift"),
  workStart: timeSchema.nullable().optional(),
  workEnd: timeSchema.nullable().optional(),
});

export const updateShiftSchema = z
  .strictObject({
    name: nameSchema("shift").optional(),
    workStart: timeSchema.nullable().optional(),
    workEnd: timeSchema.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((f) => f !== undefined), "Minimal satu field diisi.");

/* --------------------------- Absensi ------------------------------ */

const attendanceStatusSchema = z.enum(["present", "absent", "late", "leave", "sick", "permit"]);

export const recordAttendanceSchema = z.strictObject({
  employeeId: idSchema,
  workDate: dateSchema,
  shiftId: idSchema.nullable().optional(),
  checkInAt: datetimeSchema.nullable().optional(),
  checkOutAt: datetimeSchema.nullable().optional(),
  status: attendanceStatusSchema.optional(),
  overtimeMinutes: intSchema.min(0).max(960).optional(),
  notes: optionalText(2000, "Catatan"),
});

export const listAttendanceQuerySchema = z.strictObject({
  employeeId: idSchema.optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
});

/* ---------------------------- Cuti -------------------------------- */

export const createLeaveTypeSchema = z.strictObject({
  code: codeSchema("jenis cuti"),
  name: nameSchema("jenis cuti"),
  paid: z.boolean().optional(),
  defaultQuotaDays: decimalSchema.nullable().optional(),
  requiresApproval: z.boolean().optional(),
});

export const updateLeaveTypeSchema = z
  .strictObject({
    name: nameSchema("jenis cuti").optional(),
    paid: z.boolean().optional(),
    defaultQuotaDays: decimalSchema.nullable().optional(),
    requiresApproval: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((f) => f !== undefined), "Minimal satu field diisi.");

export const createLeaveBalanceSchema = z.strictObject({
  employeeId: idSchema,
  leaveTypeId: idSchema,
  year: intSchema.min(1900).max(9999),
  totalDays: decimalSchema,
});

export const createLeaveRequestSchema = z.strictObject({
  employeeId: idSchema,
  leaveTypeId: idSchema,
  startDate: dateSchema,
  endDate: dateSchema,
  days: decimalSchema,
  reason: optionalText(2000, "Alasan"),
});

export const decideRequestSchema = z.strictObject({
  approverId: idSchema.optional(),
});

/* --------------------------- Lembur ------------------------------- */

export const createOvertimeSchema = z.strictObject({
  employeeId: idSchema,
  workDate: dateSchema,
  startAt: datetimeSchema,
  endAt: datetimeSchema,
  hours: decimalSchema,
  reason: optionalText(2000, "Alasan"),
});

/* -------------------------- Evaluasi ------------------------------ */

const evaluationStatusSchema = z.enum(["draft", "reviewed", "finalized"]);

export const createEvaluationSchema = z.strictObject({
  employeeId: idSchema,
  periodLabel: z.string().trim().min(1, "Periode wajib diisi.").max(50),
  reviewerId: idSchema.nullable().optional(),
  score: decimalSchema.nullable().optional(),
  rating: optionalText(50, "Peringkat"),
  status: evaluationStatusSchema.optional(),
  notes: optionalText(2000, "Catatan"),
});

export const updateEvaluationSchema = z
  .strictObject({
    reviewerId: idSchema.nullable().optional(),
    score: decimalSchema.nullable().optional(),
    rating: optionalText(50, "Peringkat"),
    status: evaluationStatusSchema.optional(),
    notes: optionalText(2000, "Catatan"),
  })
  .refine((v) => Object.values(v).some((f) => f !== undefined), "Minimal satu field diisi.");

/* --------------------------- Pelatihan ---------------------------- */

export const createTrainingProgramSchema = z.strictObject({
  code: codeSchema("program pelatihan"),
  name: nameSchema("program pelatihan"),
  provider: optionalText(200, "Penyelenggara"),
});

export const updateTrainingProgramSchema = z
  .strictObject({
    name: nameSchema("program pelatihan").optional(),
    provider: optionalText(200, "Penyelenggara"),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((f) => f !== undefined), "Minimal satu field diisi.");

const trainingStatusSchema = z.enum(["enrolled", "in_progress", "completed", "cancelled"]);

export const createEnrollmentSchema = z.strictObject({
  programId: idSchema,
  employeeId: idSchema,
  status: trainingStatusSchema.optional(),
});

export const updateEnrollmentSchema = z
  .strictObject({
    status: trainingStatusSchema.optional(),
    completedAt: datetimeSchema.nullable().optional(),
  })
  .refine((v) => Object.values(v).some((f) => f !== undefined), "Minimal satu field diisi.");

/* ------------------------------------------------------------------ */
/* Tipe                                                                */
/* ------------------------------------------------------------------ */

export type CreatePositionInput = z.output<typeof createPositionSchema>;
export type UpdatePositionInput = z.output<typeof updatePositionSchema>;
export type ListPositionsQuery = z.output<typeof listPositionsQuerySchema>;
export type CreateEmployeeInput = z.output<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.output<typeof updateEmployeeSchema>;
export type ListEmployeesQuery = z.output<typeof listEmployeesQuerySchema>;
export type CreateDocumentInput = z.output<typeof createDocumentSchema>;
export type UpdateDocumentInput = z.output<typeof updateDocumentSchema>;
export type CreateContractInput = z.output<typeof createContractSchema>;
export type UpdateContractInput = z.output<typeof updateContractSchema>;
export type CreateShiftInput = z.output<typeof createShiftSchema>;
export type UpdateShiftInput = z.output<typeof updateShiftSchema>;
export type RecordAttendanceInput = z.output<typeof recordAttendanceSchema>;
export type ListAttendanceQuery = z.output<typeof listAttendanceQuerySchema>;
export type CreateLeaveTypeInput = z.output<typeof createLeaveTypeSchema>;
export type UpdateLeaveTypeInput = z.output<typeof updateLeaveTypeSchema>;
export type CreateLeaveBalanceInput = z.output<typeof createLeaveBalanceSchema>;
export type CreateLeaveRequestInput = z.output<typeof createLeaveRequestSchema>;
export type DecideRequestInput = z.output<typeof decideRequestSchema>;
export type CreateOvertimeInput = z.output<typeof createOvertimeSchema>;
export type CreateEvaluationInput = z.output<typeof createEvaluationSchema>;
export type UpdateEvaluationInput = z.output<typeof updateEvaluationSchema>;
export type CreateTrainingProgramInput = z.output<typeof createTrainingProgramSchema>;
export type UpdateTrainingProgramInput = z.output<typeof updateTrainingProgramSchema>;
export type CreateEnrollmentInput = z.output<typeof createEnrollmentSchema>;
export type UpdateEnrollmentInput = z.output<typeof updateEnrollmentSchema>;
