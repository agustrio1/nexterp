import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { actorColumns } from "./_actors";
import { primaryId, timestamps, timestamptz } from "./_columns";
import { journalEntries } from "./accounting";
import { branches } from "./organization";
import { employees } from "./hr";
import { users } from "./identity";

/* ------------------------------------------------------------------ */
/* Tahap 7D: Payroll (struktur & komponen gaji, kompensasi berlaku-    */
/*            tanggal, statutory_rules konfiguratif, periode, run,     */
/*            item + komponen, penyesuaian, slip gaji snapshot)        */
/* ------------------------------------------------------------------ */
// Mesin payroll KONFIGURATIF: tarif/parameter pajak & iuran disimpan sebagai data
// efektif-tanggal di statutory_rules (+ brackets) dengan kolom `source` WAJIB.
// Kode TIDAK pernah mengarang angka regulasi. Semua nominal string desimal via
// src/lib/money.ts; jurnal payroll selalu dalam mata uang dasar (IDR).
// Lifecycle run mirror AP/AR: draft -> calculated -> approved -> posted -> (reversed).

/* ----------------------------- Enums ------------------------------ */

export const payFrequencyEnum = pgEnum("pay_frequency", ["monthly", "bimonthly", "weekly"]);

export const salaryComponentKindEnum = pgEnum("salary_component_kind", ["earning", "deduction"]);

export const componentBasisEnum = pgEnum("component_basis", [
  "fixed",
  "percentage_of_base",
  "statutory",
  "attendance",
]);

export const statutoryKindEnum = pgEnum("statutory_kind", [
  "pph21",
  "bpjs_kesehatan",
  "bpjs_jht",
  "bpjs_jp",
  "bpjs_kk",
  "bpjs_jkm",
  "other",
]);

export const partyShareEnum = pgEnum("party_share", ["employee", "employer", "both"]);

export const payrollPeriodStatusEnum = pgEnum("payroll_period_status", [
  "draft",
  "finalized",
  "posted",
  "closed",
]);

export const payrollRunStatusEnum = pgEnum("payroll_run_status", [
  "draft",
  "calculated",
  "approved",
  "posted",
  "cancelled",
  "reversed",
]);

export const payslipStatusEnum = pgEnum("payslip_status", ["issued", "void"]);

/* ------------------------- Struktur gaji -------------------------- */

/** Kelompok komponen gaji + frekuensi bayarnya. */
export const salaryStructures = pgTable(
  "salary_structures",
  {
    id: primaryId(),
    code: text().notNull(),
    name: text().notNull(),
    payFrequency: payFrequencyEnum().notNull().default("monthly"),
    isActive: boolean().notNull().default(true),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("salary_structures_code_uq").on(t.code),
    check("salary_structures_code_chk", sql`length(trim(${t.code})) > 0`),
    check("salary_structures_name_chk", sql`length(trim(${t.name})) > 0`),
  ],
);

/** Master komponen gaji (earning/deduction) + perannya pada base pajak/iuran. */
export const salaryComponents = pgTable(
  "salary_components",
  {
    id: primaryId(),
    code: text().notNull(),
    name: text().notNull(),
    kind: salaryComponentKindEnum().notNull(),
    basis: componentBasisEnum().notNull(),
    statutoryKind: statutoryKindEnum(),
    orderNo: integer().notNull().default(1),
    includeInTaxBase: boolean().notNull().default(false),
    includeInBpjsBase: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("salary_components_code_uq").on(t.code),
    check("salary_components_code_chk", sql`length(trim(${t.code})) > 0`),
    check("salary_components_name_chk", sql`length(trim(${t.name})) > 0`),
    check("salary_components_order_chk", sql`${t.orderNo} >= 1`),
  ],
);

/** Keanggotaan komponen dalam sebuah struktur (banyak-ke-banyak). */
export const salaryStructureComponents = pgTable(
  "salary_structure_components",
  {
    id: primaryId(),
    structureId: uuid()
      .notNull()
      .references(() => salaryStructures.id, { onDelete: "cascade" }),
    componentId: uuid()
      .notNull()
      .references(() => salaryComponents.id),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("salary_structure_components_pair_uq").on(t.structureId, t.componentId),
    index("salary_structure_components_component_idx").on(t.componentId),
  ],
);

/* ---------------------- Kompensasi karyawan ----------------------- */

/** Gaji pokok + struktur yang berlaku-tanggal per karyawan. */
export const employeeCompensations = pgTable(
  "employee_compensations",
  {
    id: primaryId(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id),
    structureId: uuid().references(() => salaryStructures.id),
    baseSalary: numeric({ precision: 18, scale: 2 }).notNull(),
    effectiveFrom: date().notNull(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("employee_compensations_employee_effective_uq").on(t.employeeId, t.effectiveFrom),
    index("employee_compensations_structure_idx").on(t.structureId),
    check("employee_compensations_base_chk", sql`${t.baseSalary} > 0`),
  ],
);

/** Nilai tetap/percent komponen per karyawan (berlaku-tanggal). */
export const payrollComponentValues = pgTable(
  "payroll_component_values",
  {
    id: primaryId(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id),
    componentId: uuid()
      .notNull()
      .references(() => salaryComponents.id),
    amount: numeric({ precision: 18, scale: 2 }),
    percentValue: numeric({ precision: 9, scale: 4 }),
    effectiveFrom: date().notNull(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("payroll_component_values_employee_component_eff_uq").on(
      t.employeeId,
      t.componentId,
      t.effectiveFrom,
    ),
    index("payroll_component_values_component_idx").on(t.componentId),
    check("payroll_component_values_amount_chk", sql`${t.amount} IS NULL OR ${t.amount} >= 0`),
    check(
      "payroll_component_values_percent_chk",
      sql`${t.percentValue} IS NULL OR ${t.percentValue} >= 0`,
    ),
    check(
      "payroll_component_values_value_chk",
      sql`${t.amount} IS NOT NULL OR ${t.percentValue} IS NOT NULL`,
    ),
  ],
);

/* -------------------------- Aturan statutory ---------------------- */

/**
 * Aturan pajak/iuran konfiguratif. `source` WAJIB terisi (rujukan regulasi resmi).
 * Tidak ada nilai default di kode; tarif flat atau progresif lewat brackets.
 */
export const statutoryRules = pgTable(
  "statutory_rules",
  {
    id: primaryId(),
    code: text().notNull(),
    kind: statutoryKindEnum().notNull(),
    party: partyShareEnum().notNull(),
    name: text().notNull(),
    rate: numeric({ precision: 9, scale: 4 }),
    flatAmount: numeric({ precision: 18, scale: 2 }),
    wageCap: numeric({ precision: 18, scale: 2 }),
    belowWageCap: boolean(),
    source: text().notNull(),
    effectiveFrom: date().notNull(),
    isActive: boolean().notNull().default(true),
    notes: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("statutory_rules_code_uq").on(t.code),
    index("statutory_rules_kind_effective_idx").on(t.kind, t.effectiveFrom),
    check("statutory_rules_code_chk", sql`length(trim(${t.code})) > 0`),
    check("statutory_rules_name_chk", sql`length(trim(${t.name})) > 0`),
    check("statutory_rules_source_chk", sql`length(trim(${t.source})) > 0`),
    check("statutory_rules_rate_chk", sql`${t.rate} IS NULL OR ${t.rate} >= 0`),
    check("statutory_rules_flat_chk", sql`${t.flatAmount} IS NULL OR ${t.flatAmount} >= 0`),
    check("statutory_rules_cap_chk", sql`${t.wageCap} IS NULL OR ${t.wageCap} >= 0`),
  ],
);

/** Bracket tarif progresif (mis. PPh 21). Setiap bracket menyimpan `source` sendiri. */
export const statutoryRuleBrackets = pgTable(
  "statutory_rule_brackets",
  {
    id: primaryId(),
    ruleId: uuid()
      .notNull()
      .references(() => statutoryRules.id, { onDelete: "cascade" }),
    orderNo: integer().notNull(),
    minAmount: numeric({ precision: 18, scale: 2 }).notNull(),
    maxAmount: numeric({ precision: 18, scale: 2 }),
    rate: numeric({ precision: 9, scale: 4 }).notNull(),
    source: text().notNull(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("statutory_rule_brackets_rule_order_uq").on(t.ruleId, t.orderNo),
    check("statutory_rule_brackets_order_chk", sql`${t.orderNo} >= 1`),
    check("statutory_rule_brackets_min_chk", sql`${t.minAmount} >= 0`),
    check(
      "statutory_rule_brackets_range_chk",
      sql`${t.maxAmount} IS NULL OR ${t.maxAmount} > ${t.minAmount}`,
    ),
    check("statutory_rule_brackets_rate_chk", sql`${t.rate} >= 0`),
    check("statutory_rule_brackets_source_chk", sql`length(trim(${t.source})) > 0`),
  ],
);

/* ---------------------------- Periode ----------------------------- */

/** Periode gaji bulanan (status independen dari Periode akuntansi). */
export const payrollPeriods = pgTable(
  "payroll_periods",
  {
    id: primaryId(),
    code: text().notNull(),
    name: text().notNull(),
    periodStart: date().notNull(),
    periodEnd: date().notNull(),
    branchId: uuid().references(() => branches.id),
    status: payrollPeriodStatusEnum().notNull().default("draft"),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("payroll_periods_code_uq").on(t.code),
    index("payroll_periods_status_start_idx").on(t.status, t.periodStart),
    check("payroll_periods_code_chk", sql`length(trim(${t.code})) > 0`),
    check("payroll_periods_name_chk", sql`length(trim(${t.name})) > 0`),
    check("payroll_periods_range_chk", sql`${t.periodEnd} >= ${t.periodStart}`),
  ],
);

/* ------------------------------ Run ------------------------------- */

/**
 * Satu run payroll per periode (/cabang). Total teragregasi dari item.
 * Jurnal akrual (journalEntryId) diisi saat post; reversal via reverseJournal -> status reversed.
 */
export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: primaryId(),
    docNo: text().unique(),
    periodId: uuid()
      .notNull()
      .references(() => payrollPeriods.id),
    branchId: uuid().references(() => branches.id),
    status: payrollRunStatusEnum().notNull().default("draft"),
    employeeCount: integer().notNull().default(0),
    totalEarnings: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    totalDeductions: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    totalNet: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    journalEntryId: uuid().references(() => journalEntries.id),
    payableJournalEntryId: uuid().references(() => journalEntries.id),
    calculatedBy: uuid().references(() => users.id),
    approvedBy: uuid().references(() => users.id),
    postedAt: timestamptz(),
    cancelledAt: timestamptz(),
    reversedAt: timestamptz(),
    reason: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("payroll_runs_period_idx").on(t.periodId),
    index("payroll_runs_status_idx").on(t.status),
    check(
      "payroll_runs_docno_chk",
      sql`(${t.status} in ('draft', 'calculated', 'approved', 'cancelled') and ${t.docNo} is null) or (${t.status} in ('posted', 'reversed') and ${t.docNo} is not null)`,
    ),
    check(
      "payroll_runs_posted_chk",
      sql`${t.status} <> 'posted' or (${t.employeeCount} > 0 and ${t.totalEarnings} > 0 and ${t.journalEntryId} is not null)`,
    ),
    check(
      "payroll_runs_totals_chk",
      sql`${t.totalEarnings} >= 0 and ${t.totalDeductions} >= 0 and ${t.totalNet} >= 0`,
    ),
    check(
      "payroll_runs_cancel_chk",
      sql`${t.status} <> 'cancelled' or (${t.cancelledAt} is not null and ${t.reason} is not null)`,
    ),
    check(
      "payroll_runs_reverse_chk",
      sql`${t.status} <> 'reversed' or (${t.reversedAt} is not null and ${t.reason} is not null)`,
    ),
  ],
);

/** Hasil per karyawan dalam satu run. netPay = grossEarnings - totalDeductions (dijaga service). */
export const payrollRunItems = pgTable(
  "payroll_run_items",
  {
    id: primaryId(),
    runId: uuid()
      .notNull()
      .references(() => payrollRuns.id, { onDelete: "cascade" }),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id),
    grossEarnings: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    totalDeductions: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    netPay: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("payroll_run_items_run_employee_uq").on(t.runId, t.employeeId),
    index("payroll_run_items_employee_idx").on(t.employeeId),
    check(
      "payroll_run_items_amounts_chk",
      sql`${t.grossEarnings} >= 0 and ${t.totalDeductions} >= 0 and ${t.netPay} >= 0`,
    ),
  ],
);

/** Rincian komponen/statutory satu item run (snapshot read-only pasca-kalkulasi). */
export const payrollRunItemComponents = pgTable(
  "payroll_run_item_components",
  {
    id: primaryId(),
    runItemId: uuid()
      .notNull()
      .references(() => payrollRunItems.id, { onDelete: "cascade" }),
    componentId: uuid().references(() => salaryComponents.id),
    statutoryRuleId: uuid().references(() => statutoryRules.id),
    label: text().notNull(),
    kind: salaryComponentKindEnum().notNull(),
    basisSnapshot: jsonb(),
    amount: numeric({ precision: 18, scale: 2 }).notNull(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("payroll_run_item_components_item_idx").on(t.runItemId),
    check("payroll_run_item_components_label_chk", sql`length(trim(${t.label})) > 0`),
    check("payroll_run_item_components_amount_chk", sql`${t.amount} >= 0`),
  ],
);

/* --------------------------- Penyesuaian -------------------------- */

/** Penyesuaian manual satu-kali/berulang per karyawan (bonus, potongan) masuk kalkulasi. */
export const payrollAdjustments = pgTable(
  "payroll_adjustments",
  {
    id: primaryId(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id),
    periodId: uuid().references(() => payrollPeriods.id),
    componentId: uuid().references(() => salaryComponents.id),
    kind: salaryComponentKindEnum().notNull(),
    amount: numeric({ precision: 18, scale: 2 }).notNull(),
    effectiveFrom: date().notNull(),
    isActive: boolean().notNull().default(true),
    notes: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("payroll_adjustments_employee_idx").on(t.employeeId),
    index("payroll_adjustments_period_idx").on(t.periodId),
    check("payroll_adjustments_amount_chk", sql`${t.amount} >= 0`),
  ],
);

/* ---------------------------- Slip gaji --------------------------- */

/** Slip gaji final per karyawan-run, menyimpan snapshot JSON lengkap untuk cetak/arsip. */
export const payslips = pgTable(
  "payslips",
  {
    id: primaryId(),
    docNo: text().notNull().unique(),
    runItemId: uuid()
      .notNull()
      .references(() => payrollRunItems.id),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id),
    periodLabel: text().notNull(),
    grossEarnings: numeric({ precision: 18, scale: 2 }).notNull(),
    totalDeductions: numeric({ precision: 18, scale: 2 }).notNull(),
    netPay: numeric({ precision: 18, scale: 2 }).notNull(),
    snapshot: jsonb(),
    status: payslipStatusEnum().notNull().default("issued"),
    issuedAt: timestamptz().notNull().defaultNow(),
    reason: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("payslips_run_item_uq").on(t.runItemId),
    index("payslips_employee_idx").on(t.employeeId),
    index("payslips_status_idx").on(t.status),
    check("payslips_period_chk", sql`length(trim(${t.periodLabel})) > 0`),
    check(
      "payslips_amounts_chk",
      sql`${t.grossEarnings} >= 0 and ${t.totalDeductions} >= 0 and ${t.netPay} >= 0`,
    ),
  ],
);

/* ------------------------------ Tipe ------------------------------ */

export type PayFrequency = (typeof payFrequencyEnum.enumValues)[number];
export type SalaryComponentKind = (typeof salaryComponentKindEnum.enumValues)[number];
export type ComponentBasis = (typeof componentBasisEnum.enumValues)[number];
export type StatutoryKind = (typeof statutoryKindEnum.enumValues)[number];
export type PartyShare = (typeof partyShareEnum.enumValues)[number];
export type PayrollPeriodStatus = (typeof payrollPeriodStatusEnum.enumValues)[number];
export type PayrollRunStatus = (typeof payrollRunStatusEnum.enumValues)[number];
export type PayslipStatus = (typeof payslipStatusEnum.enumValues)[number];
