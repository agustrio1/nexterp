import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  time,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { actorColumns } from "./_actors";
import { primaryId, timestamps, timestamptz } from "./_columns";
import { branches, departments } from "./organization";
import { users } from "./identity";

/* ------------------------------------------------------------------ */
/* Tahap 7B: HR (jabatan, karyawan, kontrak, dokumen, shift, absensi,  */
/*           cuti + saldo, lembur, evaluasi, pelatihan)               */
/* ------------------------------------------------------------------ */
// Data HR bersifat master/operasional: dinonaktifkan, tidak dihapus. Tidak ada
// trigger imutabilitas finansial — entitas HR boleh berubah sepanjang lifecycle.
// Pengajuan cuti/lembur memakai status sederhana (bukan ledger GL).

/* ----------------------------- Enums ------------------------------ */

export const employeeStatusEnum = pgEnum("employee_status", [
  "probation",
  "active",
  "on_leave",
  "inactive",
  "terminated",
]);

export const contractTypeEnum = pgEnum("contract_type", [
  "pkwt",
  "pkwtt",
  "outsourcing",
  "intern",
]);

export const contractStatusEnum = pgEnum("contract_status", [
  "draft",
  "active",
  "ended",
  "cancelled",
]);

export const attendanceStatusEnum = pgEnum("attendance_status", [
  "present",
  "absent",
  "late",
  "leave",
  "sick",
  "permit",
]);

export const leaveRequestStatusEnum = pgEnum("leave_request_status", [
  "draft",
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);

export const overtimeRequestStatusEnum = pgEnum("overtime_request_status", [
  "draft",
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);

export const documentCategoryEnum = pgEnum("hr_document_category", [
  "identity",
  "academic",
  "contract",
  "tax",
  "other",
]);

export const evaluationStatusEnum = pgEnum("evaluation_status", [
  "draft",
  "reviewed",
  "finalized",
]);

export const trainingStatusEnum = pgEnum("training_status", [
  "enrolled",
  "in_progress",
  "completed",
  "cancelled",
]);

/* --------------------------- Jabatan ------------------------------ */

/** Jabatan/posisi kerja. jobGrade opsional untuk pemetaan struktur gaji. */
export const positions = pgTable(
  "positions",
  {
    id: primaryId(),
    code: text().notNull(),
    name: text().notNull(),
    departmentId: uuid().references(() => departments.id),
    jobGrade: integer(),
    isActive: boolean().notNull().default(true),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("positions_code_uq").on(t.code),
    index("positions_department_idx").on(t.departmentId),
    check("positions_code_chk", sql`length(trim(${t.code})) > 0`),
    check("positions_name_chk", sql`length(trim(${t.name})) > 0`),
    check("positions_grade_chk", sql`${t.jobGrade} IS NULL OR ${t.jobGrade} >= 0`),
  ],
);

/* --------------------------- Karyawan ----------------------------- */

/**
 * Master karyawan. `userId` (unique) menautkan ke akun login; self-service
 * resolve user sesi -> employee lewat kolom ini. `managerId` self-reference atasan.
 */
export const employees = pgTable(
  "employees",
  {
    id: primaryId(),
    code: text().notNull(),
    userId: uuid().references(() => users.id),
    firstName: text().notNull(),
    lastName: text(),
    birthDate: date(),
    gender: text(),
    npwp: text(),
    address: text(),
    phone: text(),
    email: text(),
    departmentId: uuid().references(() => departments.id),
    positionId: uuid().references(() => positions.id),
    branchId: uuid().references(() => branches.id),
    managerId: uuid().references((): AnyPgColumn => employees.id),
    dateJoined: date().notNull(),
    status: employeeStatusEnum().notNull().default("active"),
    isActive: boolean().notNull().default(true),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("employees_code_uq").on(t.code),
    uniqueIndex("employees_user_uq").on(t.userId),
    index("employees_department_idx").on(t.departmentId),
    index("employees_branch_idx").on(t.branchId),
    index("employees_status_idx").on(t.status),
    check("employees_code_chk", sql`length(trim(${t.code})) > 0`),
    check("employees_first_name_chk", sql`length(trim(${t.firstName})) > 0`),
  ],
);

/* --------------------------- Dokumen ------------------------------ */

/** Metadata dokumen karyawan (tanpa biner; object storage di luar cakupan 7). */
export const employeeDocuments = pgTable(
  "employee_documents",
  {
    id: primaryId(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    category: documentCategoryEnum().notNull(),
    name: text().notNull(),
    externalRef: text(),
    notes: text(),
    capturedAt: timestamptz().notNull().defaultNow(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("employee_documents_employee_idx").on(t.employeeId),
    index("employee_documents_category_idx").on(t.category),
    check("employee_documents_name_chk", sql`length(trim(${t.name})) > 0`),
  ],
);

/* --------------------------- Kontrak ------------------------------ */

/** Kontrak kerja karyawan. docNo diisi dari penomoran employment_contract. */
export const employmentContracts = pgTable(
  "employment_contracts",
  {
    id: primaryId(),
    docNo: text(),
    employeeId: uuid().notNull().references(() => employees.id),
    code: text().notNull(),
    type: contractTypeEnum().notNull(),
    startDate: date().notNull(),
    endDate: date(),
    status: contractStatusEnum().notNull().default("draft"),
    notes: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("employment_contracts_code_uq").on(t.code),
    index("employment_contracts_employee_idx").on(t.employeeId),
    index("employment_contracts_status_idx").on(t.status),
    check("employment_contracts_code_chk", sql`length(trim(${t.code})) > 0`),
    check(
      "employment_contracts_period_chk",
      sql`${t.endDate} IS NULL OR ${t.endDate} >= ${t.startDate}`,
    ),
  ],
);

/* ---------------------------- Shift ------------------------------- */

/** Shift kerja standar (jam mulai/selesai). */
export const shifts = pgTable(
  "shifts",
  {
    id: primaryId(),
    code: text().notNull(),
    name: text().notNull(),
    workStart: time(),
    workEnd: time(),
    isActive: boolean().notNull().default(true),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("shifts_code_uq").on(t.code),
    check("shifts_code_chk", sql`length(trim(${t.code})) > 0`),
    check("shifts_name_chk", sql`length(trim(${t.name})) > 0`),
  ],
);

/* --------------------------- Absensi ------------------------------ */

/** Catatan absensi harian per karyawan (append/koreksi; bukan ledger finansial). */
export const attendanceLogs = pgTable(
  "attendance_logs",
  {
    id: primaryId(),
    employeeId: uuid().notNull().references(() => employees.id),
    workDate: date().notNull(),
    shiftId: uuid().references(() => shifts.id),
    checkInAt: timestamptz(),
    checkOutAt: timestamptz(),
    status: attendanceStatusEnum().notNull().default("present"),
    overtimeMinutes: integer().notNull().default(0),
    notes: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("attendance_logs_employee_date_uq").on(t.employeeId, t.workDate),
    index("attendance_logs_date_idx").on(t.workDate),
    index("attendance_logs_status_idx").on(t.status),
    check("attendance_logs_overtime_chk", sql`${t.overtimeMinutes} >= 0`),
  ],
);

/* ---------------------------- Cuti -------------------------------- */

/** Jenis cuti (kuota default = kebijakan perusahaan, BUKAN regulasi). */
export const leaveTypes = pgTable(
  "leave_types",
  {
    id: primaryId(),
    code: text().notNull(),
    name: text().notNull(),
    paid: boolean().notNull().default(true),
    defaultQuotaDays: numeric({ precision: 18, scale: 2 }),
    requiresApproval: boolean().notNull().default(true),
    isActive: boolean().notNull().default(true),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("leave_types_code_uq").on(t.code),
    check("leave_types_code_chk", sql`length(trim(${t.code})) > 0`),
    check("leave_types_name_chk", sql`length(trim(${t.name})) > 0`),
    check("leave_types_quota_chk", sql`${t.defaultQuotaDays} IS NULL OR ${t.defaultQuotaDays} >= 0`),
  ],
);

/** Saldo cuti per karyawan/jenis/tahun. */
export const leaveBalances = pgTable(
  "leave_balances",
  {
    id: primaryId(),
    employeeId: uuid().notNull().references(() => employees.id),
    leaveTypeId: uuid().notNull().references(() => leaveTypes.id),
    year: integer().notNull(),
    totalDays: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    usedDays: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("leave_balances_employee_type_year_uq").on(
      t.employeeId,
      t.leaveTypeId,
      t.year,
    ),
    index("leave_balances_year_idx").on(t.year),
    check("leave_balances_year_chk", sql`${t.year} >= 1900 AND ${t.year} <= 9999`),
    check("leave_balances_total_chk", sql`${t.totalDays} >= 0`),
    check("leave_balances_used_chk", sql`${t.usedDays} >= 0`),
  ],
);

/** Pengajuan cuti. docNo diisi dari penomoran leave_request. */
export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: primaryId(),
    docNo: text(),
    employeeId: uuid().notNull().references(() => employees.id),
    leaveTypeId: uuid().notNull().references(() => leaveTypes.id),
    startDate: date().notNull(),
    endDate: date().notNull(),
    days: numeric({ precision: 18, scale: 2 }).notNull(),
    status: leaveRequestStatusEnum().notNull().default("draft"),
    reason: text(),
    approverId: uuid().references(() => users.id),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("leave_requests_employee_idx").on(t.employeeId),
    index("leave_requests_status_idx").on(t.status),
    check("leave_requests_period_chk", sql`${t.endDate} >= ${t.startDate}`),
    check("leave_requests_days_chk", sql`${t.days} > 0`),
  ],
);

/* --------------------------- Lembur ------------------------------- */

/** Pengajuan lembur. docNo diisi dari penomoran overtime_request. */
export const overtimeRequests = pgTable(
  "overtime_requests",
  {
    id: primaryId(),
    docNo: text(),
    employeeId: uuid().notNull().references(() => employees.id),
    workDate: date().notNull(),
    startAt: timestamptz().notNull(),
    endAt: timestamptz().notNull(),
    hours: numeric({ precision: 18, scale: 2 }).notNull(),
    status: overtimeRequestStatusEnum().notNull().default("draft"),
    reason: text(),
    approverId: uuid().references(() => users.id),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("overtime_requests_employee_idx").on(t.employeeId),
    index("overtime_requests_date_idx").on(t.workDate),
    index("overtime_requests_status_idx").on(t.status),
    check("overtime_requests_hours_chk", sql`${t.hours} > 0`),
  ],
);

/* ------------------------- Evaluasi ------------------------------- */

/** Evaluasi kinerja periodik karyawan. */
export const performanceEvaluations = pgTable(
  "performance_evaluations",
  {
    id: primaryId(),
    employeeId: uuid().notNull().references(() => employees.id),
    periodLabel: text().notNull(),
    reviewerId: uuid().references(() => users.id),
    score: numeric({ precision: 5, scale: 2 }),
    rating: text(),
    status: evaluationStatusEnum().notNull().default("draft"),
    notes: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("performance_evaluations_employee_period_uq").on(t.employeeId, t.periodLabel),
    index("performance_evaluations_status_idx").on(t.status),
    check("performance_evaluations_period_chk", sql`length(trim(${t.periodLabel})) > 0`),
    check("performance_evaluations_score_chk", sql`${t.score} IS NULL OR ${t.score} >= 0`),
  ],
);

/* ------------------------- Pelatihan ------------------------------ */

/** Program pelatihan. */
export const trainingPrograms = pgTable(
  "training_programs",
  {
    id: primaryId(),
    code: text().notNull(),
    name: text().notNull(),
    provider: text(),
    isActive: boolean().notNull().default(true),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("training_programs_code_uq").on(t.code),
    check("training_programs_code_chk", sql`length(trim(${t.code})) > 0`),
    check("training_programs_name_chk", sql`length(trim(${t.name})) > 0`),
  ],
);

/** Pendaftaran karyawan pada program pelatihan. */
export const trainingEnrollments = pgTable(
  "training_enrollments",
  {
    id: primaryId(),
    programId: uuid().notNull().references(() => trainingPrograms.id),
    employeeId: uuid().notNull().references(() => employees.id),
    status: trainingStatusEnum().notNull().default("enrolled"),
    completedAt: timestamptz(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("training_enrollments_program_employee_uq").on(t.programId, t.employeeId),
    index("training_enrollments_employee_idx").on(t.employeeId),
  ],
);
