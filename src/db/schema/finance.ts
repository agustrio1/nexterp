import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { actorColumns } from "./_actors";
import { primaryId, timestamps, timestamptz } from "./_columns";
import { users } from "./identity";
import { accountingPeriods, branches, fiscalYears } from "./organization";
import { chartAccounts, journalEntries } from "./accounting";

/**
 * Skema Tahap 4G: pusat biaya (cost centers), konfigurasi pajak efektif-dated,
 * dan subledger transaksi pajak. Seluruh nominal memakai numeric(18,2); tarif
 * pajak memakai numeric(9,4) sebagai persen (mis. 11.0000 = 11%).
 */

/** Jenis pajak: pajak keluaran (dipungut), masukan (dibayar), pemotongan/pungutan pihak ketiga. */
export const taxKindEnum = pgEnum("tax_kind", ["output", "input", "withholding"]);

/** Arah tax transaction: memungut pajak (tertagih) atau membayar/menyetor pajak. */
export const taxTransactionDirectionEnum = pgEnum("tax_transaction_direction", [
  "collect",
  "pay",
]);

/**
 * Pusat biaya berbentuk pohon (opsional `parentId`). Sama seperti departemen,
 * tidak dihapus, hanya dinonaktifkan. Dipakai sebagai dimensi pelaporan pada
 * baris jurnal dan laporan per pusat biaya.
 */
export const costCenters = pgTable(
  "cost_centers",
  {
    id: primaryId(),
    code: text().notNull().unique(),
    name: text().notNull(),
    parentId: uuid().references((): AnyPgColumn => costCenters.id),
    // NULL = cost center berlaku untuk seluruh perusahaan.
    branchId: uuid().references(() => branches.id),
    isActive: boolean().notNull().default(true),
    description: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("cost_centers_parent_idx").on(t.parentId),
    index("cost_centers_branch_idx").on(t.branchId),
    check("cost_centers_code_chk", sql`length(trim(${t.code})) > 0`),
    check("cost_centers_parent_chk", sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
  ],
);

/**
 * Master pajak. Akun penampung (`taxAccountId`) menunjuk akun COA postable
 * (umumnya liabilitas untuk pajak keluaran, aset untuk pajak masukan).
 */
export const taxes = pgTable(
  "taxes",
  {
    id: primaryId(),
    code: text().notNull().unique(),
    name: text().notNull(),
    kind: taxKindEnum().notNull(),
    taxAccountId: uuid()
      .notNull()
      .references(() => chartAccounts.id),
    isActive: boolean().notNull().default(true),
    description: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("taxes_account_idx").on(t.taxAccountId),
    check("taxes_code_chk", sql`length(trim(${t.code})) > 0`),
  ],
);

/**
 * Riwayat tarif pajak bertanggal efektif. Tarif berlaku pada suatu tanggal =
 * `effectiveFrom` terbaru yang <= tanggal tersebut. `source` WAJIB terisi (rujukan
 * resmi) — sistem tidak pernah mengarang tarif; nilai diisi operator.
 */
export const taxRates = pgTable(
  "tax_rates",
  {
    id: primaryId(),
    taxId: uuid()
      .notNull()
      .references(() => taxes.id),
    rate: numeric({ precision: 9, scale: 4 }).notNull(),
    effectiveFrom: date({ mode: "string" }).notNull(),
    source: text().notNull(),
    note: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("tax_rates_tax_effective_uq").on(t.taxId, t.effectiveFrom),
    index("tax_rates_tax_date_idx").on(t.taxId, t.effectiveFrom),
    check("tax_rates_rate_chk", sql`${t.rate} >= 0`),
    check("tax_rates_source_chk", sql`length(trim(${t.source})) > 0`),
  ],
);

/**
 * Subledger transaksi pajak. Rate disnapshot saat pembuatan sehingga perubahan
 * tarif berikutnya tidak mengubah histori. `journalEntryId` dapat ditautkan ke
 * jurnal terposting (integrasi jurnal terjadi pada AP/AR Tahap 5/6).
 */
export const taxTransactions = pgTable(
  "tax_transactions",
  {
    id: primaryId(),
    docNo: text().notNull().unique(),
    taxId: uuid()
      .notNull()
      .references(() => taxes.id),
    transactionDate: date({ mode: "string" }).notNull(),
    // Diisi saat pembuatan dari periode yang memuat tanggal (bila ada & tidak tertutup diabaikan; nullable).
    periodId: uuid().references(() => accountingPeriods.id),
    direction: taxTransactionDirectionEnum().notNull(),
    baseAmount: numeric({ precision: 18, scale: 2 }).notNull(),
    rate: numeric({ precision: 9, scale: 4 }).notNull(),
    taxAmount: numeric({ precision: 18, scale: 2 }).notNull(),
    branchId: uuid().references(() => branches.id),
    costCenterId: uuid().references(() => costCenters.id),
    journalEntryId: uuid().references(() => journalEntries.id),
    notes: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("tax_transactions_tax_idx").on(t.taxId, t.transactionDate),
    index("tax_transactions_period_idx").on(t.periodId),
    check("tax_transactions_base_chk", sql`${t.baseAmount} >= 0`),
    check("tax_transactions_amount_chk", sql`${t.taxAmount} >= 0`),
    check("tax_transactions_rate_chk", sql`${t.rate} >= 0`),
  ],
);

/** Tipe turunan untuk kenyamanan service. */
export type TaxKind = (typeof taxKindEnum.enumValues)[number];
export type TaxDirection = (typeof taxTransactionDirectionEnum.enumValues)[number];

/* ------------------------------------------------------------------ */
/* Tahap 4H: kas & bank                                                */
/* ------------------------------------------------------------------ */

/** Jenis akun kas/bank: `cash` = kas fisik, `bank` = rekening bank. */
export const bankAccountKindEnum = pgEnum("bank_account_kind", ["cash", "bank"]);

/** Jenis mutasi kas/bank: penerimaan, pengeluaran, atau transfer antar rekening. */
export const cashTransactionTypeEnum = pgEnum("cash_transaction_type", [
  "receipt",
  "disbursement",
  "transfer",
]);

/** Siklus hidup transaksi kas mengikuti jurnal: draf -> posted; reversed/cancelled. */
export const cashTransactionStatusEnum = pgEnum("cash_transaction_status", [
  "draft",
  "posted",
  "reversed",
  "cancelled",
]);

/**
 * Master kas/bank. Setiap rekening menunjuk satu akun COA (aset, postable) yang
 * menampung saldonya di GL. Saldo TIDAK disimpan di sini; selalu diturunkan dari
 * baris jurnal akun terkait (prinsip "tanpa tabel saldo").
 */
export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: primaryId(),
    code: text().notNull().unique(),
    name: text().notNull(),
    // Akun GL penampung: wajib aset + postable + aktif (divalidasi service).
    accountId: uuid()
      .notNull()
      .references(() => chartAccounts.id),
    kind: bankAccountKindEnum().notNull(),
    bankName: text(),
    accountNumber: text(),
    // NULL = rekening berlaku untuk seluruh perusahaan.
    branchId: uuid().references(() => branches.id),
    isActive: boolean().notNull().default(true),
    description: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("bank_accounts_account_idx").on(t.accountId),
    index("bank_accounts_branch_idx").on(t.branchId),
    check("bank_accounts_code_chk", sql`length(trim(${t.code})) > 0`),
  ],
);

/**
 * Mutasi kas/bank (subledger uang) yang menjadi dokumen sumber jurnal double-entry.
 * - receipt: Dr rekening bank, Cr `contraAccountId`.
 * - disbursement: Dr `contraAccountId`, Cr rekening bank.
 * - transfer: Dr rekening `counterpartBankAccountId`, Cr rekening bank.
 * Nomor (`docNo`) dan `journalEntryId` diisi saat posting (model draf -> post).
 */
export const cashTransactions = pgTable(
  "cash_transactions",
  {
    id: primaryId(),
    docNo: text().unique(),
    transactionDate: date({ mode: "string" }).notNull(),
    type: cashTransactionTypeEnum().notNull(),
    status: cashTransactionStatusEnum().notNull().default("draft"),
    // Rekening kas/bank utama (sisi kas transaksi).
    bankAccountId: uuid()
      .notNull()
      .references(() => bankAccounts.id),
    // Akun lawan GL untuk receipt/disbursement (nullable untuk transfer).
    contraAccountId: uuid().references(() => chartAccounts.id),
    // Rekening lawan untuk transfer (nullable selain transfer).
    counterpartBankAccountId: uuid().references(() => bankAccounts.id),
    amount: numeric({ precision: 18, scale: 2 }).notNull(),
    branchId: uuid().references(() => branches.id),
    costCenterId: uuid().references(() => costCenters.id),
    // Jurnal double-entry hasil posting (diisi saat status posted/reversed).
    journalEntryId: uuid().references(() => journalEntries.id),
    description: text().notNull(),
    reference: text(),
    // Alasan pembatalan (draf) atau reversal.
    reason: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("cash_transactions_account_date_idx").on(t.bankAccountId, t.transactionDate),
    index("cash_transactions_journal_idx").on(t.journalEntryId),
    check("cash_transactions_amount_chk", sql`${t.amount} > 0`),
    check(
      "cash_transactions_party_chk",
      sql`(${t.type} = 'transfer' AND ${t.counterpartBankAccountId} is not null AND ${t.contraAccountId} is null)
        OR (${t.type} in ('receipt', 'disbursement') AND ${t.contraAccountId} is not null AND ${t.counterpartBankAccountId} is null)`,
    ),
    check(
      "cash_transactions_self_transfer_chk",
      sql`${t.counterpartBankAccountId} is null or ${t.counterpartBankAccountId} <> ${t.bankAccountId}`,
    ),
    check("cash_transactions_draft_no_number_chk", sql`${t.status} <> 'draft' or ${t.docNo} is null`),
    check(
      "cash_transactions_posted_fields_chk",
      sql`${t.status} in ('draft', 'cancelled') or (${t.docNo} is not null and ${t.journalEntryId} is not null)`,
    ),
    check(
      "cash_transactions_cancel_reason_chk",
      sql`${t.status} <> 'cancelled' or ${t.reason} is not null`,
    ),
  ],
);

/** Tipe turunan untuk kenyamanan service 4H. */
export type BankAccountKind = (typeof bankAccountKindEnum.enumValues)[number];
export type CashTransactionType = (typeof cashTransactionTypeEnum.enumValues)[number];
export type CashTransactionStatus = (typeof cashTransactionStatusEnum.enumValues)[number];

/* ------------------------------------------------------------------ */
/* Tahap 4I: anggaran                                                  */
/* ------------------------------------------------------------------ */

/**
 * Siklus hidup anggaran. `draft` bebas diubah; `approved` terkunci (baris & header
 * tidak boleh diubah lagi — revisi lewat anggaran baru). Tidak ada penghapusan.
 */
export const budgetStatusEnum = pgEnum("budget_status", ["draft", "approved"]);

/**
 * Header anggaran per tahun fiskal, opsional per cabang. `docNo` diisi saat
 * persetujuan (nomor dokumen), mengikuti pola draf -> final 4H/4D.
 */
export const budgets = pgTable(
  "budgets",
  {
    id: primaryId(),
    docNo: text().unique(),
    name: text().notNull(),
    fiscalYearId: uuid()
      .notNull()
      .references(() => fiscalYears.id),
    // NULL = anggaran berlaku untuk seluruh perusahaan.
    branchId: uuid().references(() => branches.id),
    status: budgetStatusEnum().notNull().default("draft"),
    notes: text(),
    approvedAt: timestamptz(),
    approvedBy: uuid().references(() => users.id),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("budgets_fiscal_year_idx").on(t.fiscalYearId),
    index("budgets_branch_idx").on(t.branchId),
    check("budgets_name_chk", sql`length(trim(${t.name})) > 0`),
    // Approved wajib punya nomor dokumen dan penanda persetujuan.
    check(
      "budgets_approved_fields_chk",
      sql`${t.status} <> 'approved' or (${t.docNo} is not null and ${t.approvedAt} is not null and ${t.approvedBy} is not null)`,
    ),
    // Draft tidak boleh bernomor.
    check("budgets_draft_no_number_chk", sql`${t.status} <> 'draft' or ${t.docNo} is null`),
  ],
);

/**
 * Baris anggaran: satu nominal per akun per periode (bulanan) dan opsional pusat
 * biaya. Realisasi dihitung dari mutasi jurnal akun tersebut pada periode yang sama.
 */
export const budgetLines = pgTable(
  "budget_lines",
  {
    id: primaryId(),
    budgetId: uuid()
      .notNull()
      .references(() => budgets.id),
    accountId: uuid()
      .notNull()
      .references(() => chartAccounts.id),
    // Periode reguler tahun fiskal header; wajib milik fiscalYearId yang sama (divalidasi service).
    periodId: uuid()
      .notNull()
      .references(() => accountingPeriods.id),
    costCenterId: uuid().references(() => costCenters.id),
    amount: numeric({ precision: 18, scale: 2 }).notNull(),
    note: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("budget_lines_budget_idx").on(t.budgetId),
    index("budget_lines_account_idx").on(t.accountId),
    index("budget_lines_period_idx").on(t.periodId),
    // Tanpa pusat biaya: satu baris per (anggaran, akun, periode) ditegakkan di DB.
    uniqueIndex("budget_lines_bud_acct_period_uq")
      .on(t.budgetId, t.accountId, t.periodId)
      .where(sql`${t.costCenterId} is null`),
    check("budget_lines_amount_chk", sql`${t.amount} >= 0`),
  ],
);

/** Tipe turunan untuk kenyamanan service 4I. */
export type BudgetStatus = (typeof budgetStatusEnum.enumValues)[number];

/* ------------------------------------------------------------------ */
/* Tahap 4H-C: impor mutasi bank & rekonsiliasi                       */
/* ------------------------------------------------------------------ */

/** Arah baris statement bank: uang masuk (`in`) atau keluar (`out`) ke rekening. */
export const bankStatementDirectionEnum = pgEnum("bank_statement_direction", ["in", "out"]);

/** Siklus hidup rekonsiliasi: `draft` (cocokan berjalan) -> `final` (terkunci, selisih nol). */
export const bankReconciliationStatusEnum = pgEnum("bank_reconciliation_status", [
  "draft",
  "final",
]);

/**
 * Dokumen rekonsiliasi kas/bank per rekening per rentang tanggal. Saldo buku
 * (`bookBalanceStart`/`bookBalanceEnd`) disnapshot dari GL saat finalize; bukan
 * kolom saldo permanen. Finalisasi terminal (tanpa balik) dan tanpa jurnal.
 */
export const bankReconciliations = pgTable(
  "bank_reconciliations",
  {
    id: primaryId(),
    docNo: text().unique(),
    bankAccountId: uuid()
      .notNull()
      .references(() => bankAccounts.id),
    startDate: date({ mode: "string" }).notNull(),
    endDate: date({ mode: "string" }).notNull(),
    statementOpeningBalance: numeric({ precision: 18, scale: 2 }).notNull(),
    statementClosingBalance: numeric({ precision: 18, scale: 2 }).notNull(),
    // Diisi saat finalize dari buku besar (GL). Null selama draft.
    bookBalanceStart: numeric({ precision: 18, scale: 2 }),
    bookBalanceEnd: numeric({ precision: 18, scale: 2 }),
    status: bankReconciliationStatusEnum().notNull().default("draft"),
    notes: text(),
    finalizedAt: timestamptz(),
    finalizedBy: uuid().references(() => users.id),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("bank_reconciliations_account_range_idx").on(t.bankAccountId, t.startDate, t.endDate),
    check("bank_reconciliations_range_chk", sql`${t.endDate} >= ${t.startDate}`),
    check("bank_reconciliations_draft_no_number_chk", sql`${t.status} <> 'draft' or ${t.docNo} is null`),
    check(
      "bank_reconciliations_final_fields_chk",
      sql`${t.status} <> 'final' or (${t.docNo} is not null and ${t.finalizedAt} is not null and ${t.finalizedBy} is not null and ${t.bookBalanceEnd} is not null)`,
    ),
  ],
);

/**
 * Baris hasil impor mutasi bank. `reconciliationId` mengelompokkan baris ke suatu
 * dokumen; `matchedCashTransactionId` menautkan ke transaksi kas yang cocok.
 * Baris yang belum punya `reconciliationId` menunggu direkonsiliasi.
 */
export const bankStatementLines = pgTable(
  "bank_statement_lines",
  {
    id: primaryId(),
    bankAccountId: uuid()
      .notNull()
      .references(() => bankAccounts.id),
    statementDate: date({ mode: "string" }).notNull(),
    description: text().notNull(),
    reference: text(),
    direction: bankStatementDirectionEnum().notNull(),
    amount: numeric({ precision: 18, scale: 2 }).notNull(),
    // Saldo berjalan menurut statement (opsional, dari impor).
    bookBalanceAfter: numeric({ precision: 18, scale: 2 }),
    reconciliationId: uuid().references(() => bankReconciliations.id),
    matchedCashTransactionId: uuid().references(() => cashTransactions.id),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("bank_statement_lines_account_date_idx").on(t.bankAccountId, t.statementDate),
    index("bank_statement_lines_reconciliation_idx")
      .on(t.reconciliationId)
      .where(sql`${t.reconciliationId} is not null`),
    index("bank_statement_lines_matched_idx")
      .on(t.matchedCashTransactionId)
      .where(sql`${t.matchedCashTransactionId} is not null`),
    check("bank_statement_lines_amount_chk", sql`${t.amount} > 0`),
    check("bank_statement_lines_description_chk", sql`length(trim(${t.description})) > 0`),
  ],
);

/** Tipe turunan untuk kenyamanan service 4H-C. */
export type BankStatementDirection = (typeof bankStatementDirectionEnum.enumValues)[number];
export type BankReconciliationStatus = (typeof bankReconciliationStatusEnum.enumValues)[number];
