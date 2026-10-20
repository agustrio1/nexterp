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
import { chartAccounts, journalEntries } from "./accounting";
import { costCenters, bankAccounts } from "./finance";
import { accountingPeriods, branches, departments } from "./organization";
import { users } from "./identity";

/* ------------------------------------------------------------------ */
/* Tahap 8B: Fixed Assets (kategori + metode penyusutan, register,     */
/*   akuisisi standalone, jadwal & usage, run penyusutan + jurnal,      */
/*   transfer, perawatan, pelepasan, revaluasi minimal)                */
/* ------------------------------------------------------------------ */
// Nilai aset diturunkan dari biaya perolehan + akumulasi penyusutan (kolom pada
// register untuk kecepatan) yang SELALU ternet dengan GL lewat rekonsiliasi.
// Jurnal aset memakai mesin akuntansi inti (createSystemDraft + postJournal);
// `source_type` bebas ("asset_acquisition"/"asset_depreciation"/"asset_disposal"/
// "asset_revaluation") dengan idempotensi via unique indeks sumber.
// Semua nominal string desimal numeric(18,2); tarif/persen numeric(9,4).

/* ----------------------------- Enums ------------------------------ */

export const depreciationMethodEnum = pgEnum("depreciation_method", [
  "straight_line",
  "declining_balance",
  "units_of_production",
]);

export const assetStatusEnum = pgEnum("asset_status", [
  "draft",
  "active",
  "idle",
  "in_service",
  "disposed",
]);

export const assetFundingSourceEnum = pgEnum("asset_funding_source", ["bank", "cash", "payable"]);

/** Status dokumen aset (akuisisi/pelepasan/revaluasi): lifecycle draf -> post. */
export const assetDocStatusEnum = pgEnum("asset_doc_status", [
  "draft",
  "posted",
  "reversed",
  "cancelled",
]);

/** Lifecycle run penyusutan (mirror payroll run). */
export const depreciationRunStatusEnum = pgEnum("depreciation_run_status", [
  "draft",
  "calculated",
  "approved",
  "posted",
  "cancelled",
  "reversed",
]);

/* ---------------------------- Kategori ---------------------------- */

/**
 * Kategori aset: metode & umur default + override akun GL (nullable -> fallback
 * ke companySettings via asset-account-config). Nilai tarif dipakai mesin.
 */
export const assetCategories = pgTable(
  "asset_categories",
  {
    id: primaryId(),
    code: text().notNull(),
    name: text().notNull(),
    depreciationMethod: depreciationMethodEnum().notNull().default("straight_line"),
    usefulLifeMonths: integer().notNull().default(48),
    /** Persentase nilai residu dari biaya (0..100) untuk garis lurus/unit produksi. */
    residualPercent: numeric({ precision: 9, scale: 4 }).notNull().default("0"),
    /** Tarif % per periode untuk declining balance (mis. 20). */
    decliningRatePercent: numeric({ precision: 9, scale: 4 }),
    /** Total kapasitas satuan untuk units_of_production (opsional, bisa per aset). */
    totalUnits: integer(),
    assetCostAccountId: uuid().references(() => chartAccounts.id),
    accumulatedDepreciationAccountId: uuid().references(() => chartAccounts.id),
    depreciationExpenseAccountId: uuid().references(() => chartAccounts.id),
    isActive: boolean().notNull().default(true),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("asset_categories_code_uq").on(t.code),
    check("asset_categories_code_chk", sql`length(trim(${t.code})) > 0`),
    check("asset_categories_name_chk", sql`length(trim(${t.name})) > 0`),
    check("asset_categories_life_chk", sql`${t.usefulLifeMonths} >= 1`),
    check(
      "asset_categories_residual_chk",
      sql`${t.residualPercent} >= 0 and ${t.residualPercent} < 100`,
    ),
    check(
      "asset_categories_db_rate_chk",
      sql`${t.decliningRatePercent} IS NULL OR (${t.decliningRatePercent} > 0 and ${t.decliningRatePercent} <= 100)`,
    ),
    check("asset_categories_units_chk", sql`${t.totalUnits} IS NULL OR ${t.totalUnits} > 0`),
  ],
);

/* ---------------------------- Register ---------------------------- */

/**
 * Master aset tetap. `cost` & `accumulatedDepreciation` numeric(18,2) — sumber
 * nilai buku. Parameter penyusutan boleh override kategori (nullable).
 */
export const fixedAssets = pgTable(
  "fixed_assets",
  {
    id: primaryId(),
    code: text().notNull(),
    name: text().notNull(),
    categoryId: uuid()
      .notNull()
      .references(() => assetCategories.id),
    branchId: uuid().references(() => branches.id),
    departmentId: uuid().references(() => departments.id),
    costCenterId: uuid().references(() => costCenters.id),
    location: text(),
    inServiceDate: date().notNull(),
    cost: numeric({ precision: 18, scale: 2 }).notNull(),
    accumulatedDepreciation: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    /** Override nilai residu absolut; bila null dihitung dari residualPercent kategori. */
    residualValue: numeric({ precision: 18, scale: 2 }),
    usefulLifeMonths: integer(),
    depreciationMethod: depreciationMethodEnum(),
    decliningRatePercent: numeric({ precision: 9, scale: 4 }),
    totalUnits: integer(),
    /** Kapasitas periode berjalan utk units_of_production (mis. bulan). */
    unitsPeriod: integer(),
    status: assetStatusEnum().notNull().default("draft"),
    isActive: boolean().notNull().default(true),
    notes: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("fixed_assets_code_uq").on(t.code),
    index("fixed_assets_category_idx").on(t.categoryId),
    index("fixed_assets_branch_idx").on(t.branchId),
    index("fixed_assets_status_idx").on(t.status),
    check("fixed_assets_code_chk", sql`length(trim(${t.code})) > 0`),
    check("fixed_assets_name_chk", sql`length(trim(${t.name})) > 0`),
    check("fixed_assets_cost_chk", sql`${t.cost} > 0`),
    check("fixed_assets_accum_chk", sql`${t.accumulatedDepreciation} >= 0`),
    check("fixed_assets_accum_le_cost_chk", sql`${t.accumulatedDepreciation} <= ${t.cost}`),
    check("fixed_assets_residual_chk", sql`${t.residualValue} IS NULL OR ${t.residualValue} >= 0`),
    check("fixed_assets_life_chk", sql`${t.usefulLifeMonths} IS NULL OR ${t.usefulLifeMonths} >= 1`),
    check(
      "fixed_assets_db_rate_chk",
      sql`${t.decliningRatePercent} IS NULL OR (${t.decliningRatePercent} > 0 and ${t.decliningRatePercent} <= 100)`,
    ),
    check("fixed_assets_units_chk", sql`${t.totalUnits} IS NULL OR ${t.totalUnits} > 0`),
    check("fixed_assets_unitsperiod_chk", sql`${t.unitsPeriod} IS NULL OR ${t.unitsPeriod} > 0`),
  ],
);

/* ---------------------------- Akuisisi ---------------------------- */

/**
 * Perolehan aset standalone: draf -> post (Dr Aset / Cr Bank|Kas|Utang).
 * Sumber dana bank/cas memakai rekening bank (bank_accounts); "utang" memakai
 * akun liabilitas dari companySettings (asset_payable_account_id).
 */
export const assetAcquisitions = pgTable(
  "asset_acquisitions",
  {
    id: primaryId(),
    docNo: text().unique(),
    assetId: uuid()
      .notNull()
      .references(() => fixedAssets.id),
    acquisitionDate: date().notNull(),
    amount: numeric({ precision: 18, scale: 2 }).notNull(),
    fundingSource: assetFundingSourceEnum().notNull(),
    bankAccountId: uuid().references(() => bankAccounts.id),
    journalEntryId: uuid().references(() => journalEntries.id),
    status: assetDocStatusEnum().notNull().default("draft"),
    cancelledAt: timestamptz(),
    reversedAt: timestamptz(),
    reason: text(),
    notes: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("asset_acquisitions_asset_idx").on(t.assetId),
    index("asset_acquisitions_status_idx").on(t.status),
    check("asset_acquisitions_amount_chk", sql`${t.amount} > 0`),
    check(
      "asset_acquisitions_docno_chk",
      sql`(${t.status} in ('draft', 'cancelled') and ${t.docNo} is null) or (${t.status} in ('posted', 'reversed') and ${t.docNo} is not null)`,
    ),
    check(
      "asset_acquisitions_funding_chk",
      sql`${t.fundingSource} = 'payable' OR ${t.bankAccountId} is not null`,
    ),
    check(
      "asset_acquisitions_cancel_chk",
      sql`${t.status} <> 'cancelled' or ${t.cancelledAt} is not null`,
    ),
    check(
      "asset_acquisitions_reverse_chk",
      sql`${t.status} <> 'reversed' or (${t.reversedAt} is not null and ${t.reason} is not null)`,
    ),
  ],
);

/* ------------------------- Pemakaian (usage) ---------------------- */

/** Input pemakaian per aset per periode untuk metode units_of_production. */
export const assetUsageEntries = pgTable(
  "asset_usage_entries",
  {
    id: primaryId(),
    assetId: uuid()
      .notNull()
      .references(() => fixedAssets.id, { onDelete: "cascade" }),
    periodKey: text().notNull(),
    units: integer().notNull(),
    notes: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("asset_usage_entries_asset_period_uq").on(t.assetId, t.periodKey),
    check("asset_usage_entries_period_chk", sql`length(trim(${t.periodKey})) > 0`),
    check("asset_usage_entries_units_chk", sql`${t.units} >= 0`),
  ],
);

/* --------------------------- Jadwal susut -------------------------- */

/**
 * Jadwal penyusutan per aset per periode. `isBooked` menandai periode yang sudah
 * dieksekusi run; `runItemId` menaut hasil run. Dijaga engine + trigger imutabilitas.
 */
export const assetDepreciationSchedules = pgTable(
  "asset_depreciation_schedules",
  {
    id: primaryId(),
    assetId: uuid()
      .notNull()
      .references(() => fixedAssets.id, { onDelete: "cascade" }),
    periodKey: text().notNull(),
    seqNo: integer().notNull(),
    openingBookValue: numeric({ precision: 18, scale: 2 }).notNull(),
    depreciationAmount: numeric({ precision: 18, scale: 2 }).notNull(),
    accumulatedAfter: numeric({ precision: 18, scale: 2 }).notNull(),
    closingBookValue: numeric({ precision: 18, scale: 2 }).notNull(),
    isBooked: boolean().notNull().default(false),
    runItemId: uuid(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("asset_depr_schedules_asset_period_uq").on(t.assetId, t.periodKey),
    index("asset_depr_schedules_period_idx").on(t.periodKey),
    check("asset_depr_schedules_period_chk", sql`length(trim(${t.periodKey})) > 0`),
    check("asset_depr_schedules_seq_chk", sql`${t.seqNo} >= 1`),
    check("asset_depr_schedules_amount_chk", sql`${t.depreciationAmount} >= 0`),
  ],
);

/* ------------------------------ Run ------------------------------- */

/** Run penyusutan per periode akuntansi; jurnal agregat Dr beban / Cr akumulasi. */
export const assetDepreciationRuns = pgTable(
  "asset_depreciation_runs",
  {
    id: primaryId(),
    docNo: text().unique(),
    periodId: uuid()
      .notNull()
      .references(() => accountingPeriods.id),
    branchId: uuid().references(() => branches.id),
    status: depreciationRunStatusEnum().notNull().default("draft"),
    assetCount: integer().notNull().default(0),
    totalDepreciation: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    journalEntryId: uuid().references(() => journalEntries.id),
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
    index("asset_depr_runs_period_idx").on(t.periodId),
    index("asset_depr_runs_status_idx").on(t.status),
    check(
      "asset_depr_runs_docno_chk",
      sql`(${t.status} in ('draft', 'calculated', 'approved', 'cancelled') and ${t.docNo} is null) or (${t.status} in ('posted', 'reversed') and ${t.docNo} is not null)`,
    ),
    check(
      "asset_depr_runs_posted_chk",
      sql`${t.status} <> 'posted' or (${t.assetCount} > 0 and ${t.totalDepreciation} > 0 and ${t.journalEntryId} is not null)`,
    ),
    check(
      "asset_depr_runs_totals_chk",
      sql`${t.totalDepreciation} >= 0 and ${t.assetCount} >= 0`,
    ),
    check(
      "asset_depr_runs_cancel_chk",
      sql`${t.status} <> 'cancelled' or (${t.cancelledAt} is not null and ${t.reason} is not null)`,
    ),
    check(
      "asset_depr_runs_reverse_chk",
      sql`${t.status} <> 'reversed' or (${t.reversedAt} is not null and ${t.reason} is not null)`,
    ),
  ],
);

/** Hasil penyusutan satu aset dalam sebuah run (snapshot nilai buku saat itu). */
export const assetDepreciationRunItems = pgTable(
  "asset_depreciation_run_items",
  {
    id: primaryId(),
    runId: uuid()
      .notNull()
      .references(() => assetDepreciationRuns.id, { onDelete: "cascade" }),
    assetId: uuid()
      .notNull()
      .references(() => fixedAssets.id),
    periodKey: text().notNull(),
    openingBookValue: numeric({ precision: 18, scale: 2 }).notNull(),
    depreciationAmount: numeric({ precision: 18, scale: 2 }).notNull(),
    accumulatedAfter: numeric({ precision: 18, scale: 2 }).notNull(),
    closingBookValue: numeric({ precision: 18, scale: 2 }).notNull(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("asset_depr_run_items_run_asset_uq").on(t.runId, t.assetId),
    index("asset_depr_run_items_asset_idx").on(t.assetId),
    check("asset_depr_run_items_period_chk", sql`length(trim(${t.periodKey})) > 0`),
    check(
      "asset_depr_run_items_amount_chk",
      sql`${t.openingBookValue} >= 0 and ${t.depreciationAmount} >= 0 and ${t.closingBookValue} >= 0`,
    ),
  ],
);

/* ----------------------------- Transfer --------------------------- */

/** Pemindahan penempatan aset (cabang/departemen/lokasi/pusat biaya). Operasional. */
export const assetTransfers = pgTable(
  "asset_transfers",
  {
    id: primaryId(),
    assetId: uuid()
      .notNull()
      .references(() => fixedAssets.id),
    transferDate: date().notNull(),
    fromBranchId: uuid().references(() => branches.id),
    toBranchId: uuid().references(() => branches.id),
    fromDepartmentId: uuid().references(() => departments.id),
    toDepartmentId: uuid().references(() => departments.id),
    toCostCenterId: uuid().references(() => costCenters.id),
    notes: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("asset_transfers_asset_idx").on(t.assetId),
    check("asset_transfers_diff_chk", sql`${t.toBranchId} IS NULL OR ${t.toBranchId} <> ${t.fromBranchId} OR ${t.toDepartmentId} IS NOT NULL`),
  ],
);

/* --------------------------- Perawatan ---------------------------- */

/** Catatan perawatan/perbaikan aset (subledger biaya operasional; tanpa jurnal otomatis). */
export const assetMaintenance = pgTable(
  "asset_maintenance",
  {
    id: primaryId(),
    assetId: uuid()
      .notNull()
      .references(() => fixedAssets.id),
    maintenanceDate: date().notNull(),
    description: text().notNull(),
    vendor: text(),
    cost: numeric({ precision: 18, scale: 2 }),
    notes: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("asset_maintenance_asset_idx").on(t.assetId),
    check("asset_maintenance_desc_chk", sql`length(trim(${t.description})) > 0`),
    check("asset_maintenance_cost_chk", sql`${t.cost} IS NULL OR ${t.cost} >= 0`),
  ],
);

/* ---------------------------- Pelepasan --------------------------- */

/**
 * Pelepasan/penjualan aset: draf -> post. Saat post aset menjadi `disposed`,
 * akumulasi & biaya dihapus dari aktif, untung/rugi dijurnal ke akun gain/loss.
 * Journal: Dr Akumulasi + Dr Bank(proceeds) / Cr Aset(cost) + Cr Gain ATAU Dr Loss.
 */
export const assetDisposals = pgTable(
  "asset_disposals",
  {
    id: primaryId(),
    docNo: text().unique(),
    assetId: uuid()
      .notNull()
      .references(() => fixedAssets.id),
    disposalDate: date().notNull(),
    proceedsAmount: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    costRemoved: numeric({ precision: 18, scale: 2 }).notNull(),
    accumulatedRemoved: numeric({ precision: 18, scale: 2 }).notNull(),
    gainAmount: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    lossAmount: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    bankAccountId: uuid().references(() => bankAccounts.id),
    journalEntryId: uuid().references(() => journalEntries.id),
    status: assetDocStatusEnum().notNull().default("draft"),
    cancelledAt: timestamptz(),
    reversedAt: timestamptz(),
    reason: text(),
    notes: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("asset_disposals_asset_idx").on(t.assetId),
    index("asset_disposals_status_idx").on(t.status),
    check("asset_disposals_proceeds_chk", sql`${t.proceedsAmount} >= 0`),
    check("asset_disposals_cost_chk", sql`${t.costRemoved} >= 0`),
    check("asset_disposals_accum_chk", sql`${t.accumulatedRemoved} >= 0`),
    check("asset_disposals_gainloss_chk", sql`${t.gainAmount} >= 0 and ${t.lossAmount} >= 0`),
    check(
      "asset_disposals_docno_chk",
      sql`(${t.status} in ('draft', 'cancelled') and ${t.docNo} is null) or (${t.status} in ('posted', 'reversed') and ${t.docNo} is not null)`,
    ),
    check(
      "asset_disposals_cancel_chk",
      sql`${t.status} <> 'cancelled' or ${t.cancelledAt} is not null`,
    ),
    check(
      "asset_disposals_reverse_chk",
      sql`${t.status} <> 'reversed' or (${t.reversedAt} is not null and ${t.reason} is not null)`,
    ),
  ],
);

/* ---------------------------- Revaluasi --------------------------- */

/** Revaluasi minimal: ubah biaya & akumulasi ke nilai baru; selisih ke ekuitas/beban. */
export const assetRevaluations = pgTable(
  "asset_revaluations",
  {
    id: primaryId(),
    docNo: text().unique(),
    assetId: uuid()
      .notNull()
      .references(() => fixedAssets.id),
    effectiveDate: date().notNull(),
    newCost: numeric({ precision: 18, scale: 2 }).notNull(),
    newAccumulated: numeric({ precision: 18, scale: 2 }).notNull(),
    journalEntryId: uuid().references(() => journalEntries.id),
    status: assetDocStatusEnum().notNull().default("draft"),
    cancelledAt: timestamptz(),
    reversedAt: timestamptz(),
    reason: text(),
    notes: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("asset_revaluations_asset_idx").on(t.assetId),
    check("asset_revaluations_cost_chk", sql`${t.newCost} > 0`),
    check("asset_revaluations_accum_chk", sql`${t.newAccumulated} >= 0 and ${t.newAccumulated} <= ${t.newCost}`),
    check(
      "asset_revaluations_docno_chk",
      sql`(${t.status} in ('draft', 'cancelled') and ${t.docNo} is null) or (${t.status} in ('posted', 'reversed') and ${t.docNo} is not null)`,
    ),
  ],
);

/* ------------------------------ Tipe ------------------------------ */

export type DepreciationMethod = (typeof depreciationMethodEnum.enumValues)[number];
export type AssetStatus = (typeof assetStatusEnum.enumValues)[number];
export type AssetFundingSource = (typeof assetFundingSourceEnum.enumValues)[number];
export type AssetDocStatus = (typeof assetDocStatusEnum.enumValues)[number];
export type DepreciationRunStatus = (typeof depreciationRunStatusEnum.enumValues)[number];
