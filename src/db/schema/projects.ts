import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { actorColumns } from "./_actors";
import { primaryId, timestamps, timestamptz } from "./_columns";
import { chartAccounts } from "./accounting";
import { costCenters } from "./finance";
import { branches } from "./organization";
import { employees } from "./hr";

/* ------------------------------------------------------------------ */
/* Tahap 8C: Projects & Cost Management (master proyek, tugas,          */
/*   milestone, penugasan, anggaran; biaya = baris jurnal ber-tag      */
/*   cost center — keputusan terkunci "proyek = cost center")          */
/* ------------------------------------------------------------------ */
// Setiap proyek menaut tepat SATU cost center (unik 1:1 di DB). Pendapatan &
// beban proyek TIDAK disimpan di tabel biaya terpisah; selalu diturunkan dari
// baris jurnal posted+reversed yang ber-tag costCenterId proyek (pola 4G/4E).
// Profitabilitas & variance anggaran dihitung service dari GL + project_budgets.
// Semua nominal string desimal numeric(18,2); persentase numeric(9,4).

/* ----------------------------- Enums ------------------------------ */

export const projectStatusEnum = pgEnum("project_status", [
  "planning",
  "in_progress",
  "on_hold",
  "completed",
  "cancelled",
]);

export const projectTaskStatusEnum = pgEnum("project_task_status", [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

/* ----------------------------- Proyek ----------------------------- */

/**
 * Master proyek. `costCenterId` wajib terisi dan unik (guard 1:1 proyek <->
 * cost center). `projectNumber` diisi service saat create dari aturan
 * numbering `project` (PRJ). `progressPercent` eksplisit (0..100); service
 * dapat menyarankan nilai dari bobot tugas selesai.
 */
export const projects = pgTable(
  "projects",
  {
    id: primaryId(),
    code: text().notNull(),
    projectNumber: text().unique(),
    name: text().notNull(),
    description: text(),
    costCenterId: uuid()
      .notNull()
      .references(() => costCenters.id),
    branchId: uuid().references(() => branches.id),
    managerEmployeeId: uuid().references(() => employees.id),
    startDate: date({ mode: "string" }).notNull(),
    endDate: date({ mode: "string" }),
    /** Pagu total proyek (nullable; anggaran rinci ada di project_budgets). */
    totalBudget: numeric({ precision: 18, scale: 2 }),
    progressPercent: numeric({ precision: 9, scale: 4 }).notNull().default("0"),
    status: projectStatusEnum().notNull().default("planning"),
    isActive: boolean().notNull().default(true),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("projects_code_uq").on(t.code),
    uniqueIndex("projects_cost_center_uq").on(t.costCenterId),
    index("projects_branch_idx").on(t.branchId),
    index("projects_status_idx").on(t.status),
    index("projects_manager_idx").on(t.managerEmployeeId),
    check("projects_code_chk", sql`length(trim(${t.code})) > 0`),
    check("projects_name_chk", sql`length(trim(${t.name})) > 0`),
    check("projects_budget_chk", sql`${t.totalBudget} IS NULL OR ${t.totalBudget} >= 0`),
    check(
      "projects_progress_chk",
      sql`${t.progressPercent} >= 0 and ${t.progressPercent} <= 100`,
    ),
    check(
      "projects_dates_chk",
      sql`${t.endDate} IS NULL OR ${t.endDate} >= ${t.startDate}`,
    ),
  ],
);

/* ------------------------------ Tugas ----------------------------- */

/**
 * Tugas proyek. `weightPercent` bobot untuk kalkulasi progres (service
 * menormalkan bobot tugas yang belum cancelled).
 */
export const projectTasks = pgTable(
  "project_tasks",
  {
    id: primaryId(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id),
    name: text().notNull(),
    assigneeEmployeeId: uuid().references(() => employees.id),
    status: projectTaskStatusEnum().notNull().default("pending"),
    sortOrder: integer().notNull().default(1),
    weightPercent: numeric({ precision: 9, scale: 4 }).notNull().default("0"),
    dueDate: date({ mode: "string" }),
    completedAt: timestamptz(),
    notes: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("project_tasks_project_idx").on(t.projectId),
    index("project_tasks_assignee_idx").on(t.assigneeEmployeeId),
    check("project_tasks_name_chk", sql`length(trim(${t.name})) > 0`),
    check("project_tasks_order_chk", sql`${t.sortOrder} >= 0`),
    check(
      "project_tasks_weight_chk",
      sql`${t.weightPercent} >= 0 and ${t.weightPercent} <= 100`,
    ),
    // Tugas selesai harus punya stempel waktu penyelesaian.
    check(
      "project_tasks_completed_chk",
      sql`${t.status} <> 'completed' or ${t.completedAt} is not null`,
    ),
  ],
);

/* ---------------------------- Milestone --------------------------- */

/** Titik pemeriksaan penting proyek; penyelesaian dicatat eksplisit. */
export const projectMilestones = pgTable(
  "project_milestones",
  {
    id: primaryId(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id),
    name: text().notNull(),
    dueDate: date({ mode: "string" }),
    isCompleted: boolean().notNull().default(false),
    completedAt: timestamptz(),
    notes: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("project_milestones_project_idx").on(t.projectId),
    check("project_milestones_name_chk", sql`length(trim(${t.name})) > 0`),
    check(
      "project_milestones_completed_chk",
      sql`${t.isCompleted} = false or ${t.completedAt} is not null`,
    ),
  ],
);

/* ---------------------------- Penugasan --------------------------- */

/** Anggota tim proyek per karyawan (1 baris per proyek+karyawan). */
export const projectAssignments = pgTable(
  "project_assignments",
  {
    id: primaryId(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id),
    role: text().notNull(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("project_assignments_project_employee_uq").on(t.projectId, t.employeeId),
    index("project_assignments_employee_idx").on(t.employeeId),
    check("project_assignments_role_chk", sql`length(trim(${t.role})) > 0`),
  ],
);

/* ----------------------------- Anggaran ---------------------------- */

/**
 * Anggaran proyek opsional per akun dan/atau periode (YYYY-MM). NULL pada
 * `accountId` = pagu seluruh akun; NULL pada `periodKey` = seluruh periode.
 * Realisasi dibandingkan dari baris jurnal ber-tag cost center proyek
 * (pola budgetRealization 4I). Keunikan ditegakkan per kombinasi via
 * unique index parsial (mengikuti pola budget_lines).
 */
export const projectBudgets = pgTable(
  "project_budgets",
  {
    id: primaryId(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id),
    accountId: uuid().references(() => chartAccounts.id),
    periodKey: text(),
    amount: numeric({ precision: 18, scale: 2 }).notNull(),
    notes: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("project_budgets_project_idx").on(t.projectId),
    index("project_budgets_account_idx").on(t.accountId),
    uniqueIndex("project_budgets_proj_acct_period_uq")
      .on(t.projectId, t.accountId, t.periodKey)
      .where(sql`${t.accountId} is not null and ${t.periodKey} is not null`),
    uniqueIndex("project_budgets_proj_acct_uq")
      .on(t.projectId, t.accountId)
      .where(sql`${t.accountId} is not null and ${t.periodKey} is null`),
    uniqueIndex("project_budgets_proj_period_uq")
      .on(t.projectId, t.periodKey)
      .where(sql`${t.accountId} is null and ${t.periodKey} is not null`),
    uniqueIndex("project_budgets_proj_uq")
      .on(t.projectId)
      .where(sql`${t.accountId} is null and ${t.periodKey} is null`),
    check("project_budgets_amount_chk", sql`${t.amount} > 0`),
    check(
      "project_budgets_period_chk",
      sql`${t.periodKey} IS NULL OR ${t.periodKey} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`,
    ),
  ],
);

/* ------------------------------ Tipe ------------------------------ */

export type ProjectStatus = (typeof projectStatusEnum.enumValues)[number];
export type ProjectTaskStatus = (typeof projectTaskStatusEnum.enumValues)[number];
