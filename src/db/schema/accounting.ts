import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  char,
  check,
  date,
  index,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { actorColumns } from "./_actors";
import { primaryId, timestamps, timestamptz } from "./_columns";
import { users } from "./identity";
import { accountingPeriods, branches, currencies, departments } from "./organization";
import { costCenters } from "./finance";

export const accountTypeEnum = pgEnum("account_type", [
  "asset",
  "liability",
  "equity",
  "revenue",
  "expense",
]);

export const journalStatusEnum = pgEnum("journal_status", [
  "draft",
  "posted",
  "reversed",
  "cancelled",
]);

/**
 * Bagan akun berbentuk pohon. Saldo normal diturunkan dari type di kode
 * (asset dan expense = debit; liability, equity, dan revenue = kredit).
 * Akun tidak dihapus, hanya dinonaktifkan. Hanya akun daun (is_postable) yang boleh dijurnal.
 * Nama tabel bukan "accounts" karena sudah dipakai Better Auth.
 */
export const chartAccounts = pgTable(
  "chart_accounts",
  {
    id: primaryId(),
    code: text().notNull().unique(),
    name: text().notNull(),
    type: accountTypeEnum().notNull(),
    parentId: uuid().references((): AnyPgColumn => chartAccounts.id),
    isPostable: boolean().notNull().default(true),
    isActive: boolean().notNull().default(true),
    description: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("chart_accounts_parent_idx").on(t.parentId),
    check("chart_accounts_code_format_chk", sql`${t.code} ~ '^[A-Za-z0-9][A-Za-z0-9.-]*$'`),
    check("chart_accounts_parent_chk", sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
  ],
);

/**
 * Header jurnal. Draf tidak bernomor; nomor, periode, dan waktu posting diisi saat posting.
 * Jurnal terposting tidak pernah diubah; koreksi lewat reversal (reversal_of_id).
 * Imutabilitas dan penjaga keseimbangan di tingkat database ada di migrasi kustom (4B-2).
 */
export const journalEntries = pgTable(
  "journal_entries",
  {
    id: primaryId(),
    docNo: text().unique(),
    entryDate: date({ mode: "string" }).notNull(),
    periodId: uuid().references(() => accountingPeriods.id),
    status: journalStatusEnum().notNull().default("draft"),
    description: text().notNull(),
    reference: text(),

    // Peristiwa dokumen sumber yang menghasilkan jurnal ini (kosong untuk jurnal manual).
    sourceType: text(),
    sourceId: uuid(),
    sourceEvent: text(),

    reversalOfId: uuid().references((): AnyPgColumn => journalEntries.id),

    totalDebit: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    totalCredit: numeric({ precision: 18, scale: 2 }).notNull().default("0"),

    postedAt: timestamptz(),
    postedBy: uuid().references(() => users.id),
    cancelledAt: timestamptz(),
    cancelledBy: uuid().references(() => users.id),
    /** Alasan pembatalan (draf) atau alasan reversal. */
    reason: text(),

    idempotencyKey: text().unique(),

    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    // Satu peristiwa sumber hanya boleh punya satu jurnal aktif (draf atau terposting).
    uniqueIndex("journal_entries_source_active_uq")
      .on(t.sourceType, t.sourceId, t.sourceEvent)
      .where(sql`${t.sourceType} is not null and ${t.status} in ('draft', 'posted')`),
    // Satu jurnal hanya boleh punya satu reversal yang tidak dibatalkan.
    uniqueIndex("journal_entries_reversal_uq")
      .on(t.reversalOfId)
      .where(sql`${t.reversalOfId} is not null and ${t.status} <> 'cancelled'`),
    // Buku besar dan laporan membaca jurnal terposting (termasuk yang sudah direversal).
    index("journal_entries_ledger_date_idx")
      .on(t.entryDate, t.id)
      .where(sql`${t.status} in ('posted', 'reversed')`),
    index("journal_entries_ledger_period_idx")
      .on(t.periodId)
      .where(sql`${t.status} in ('posted', 'reversed')`),
    index("journal_entries_status_date_idx").on(t.status, t.entryDate),

    check(
      "journal_entries_draft_no_number_chk",
      sql`${t.status} <> 'draft' or ${t.docNo} is null`,
    ),
    check(
      "journal_entries_posted_fields_chk",
      sql`${t.status} in ('draft', 'cancelled') or (${t.docNo} is not null and ${t.periodId} is not null and ${t.postedAt} is not null and ${t.postedBy} is not null)`,
    ),
    check(
      "journal_entries_balanced_chk",
      sql`${t.status} in ('draft', 'cancelled') or (${t.totalDebit} = ${t.totalCredit} and ${t.totalDebit} > 0)`,
    ),
    check("journal_entries_totals_nonneg_chk", sql`${t.totalDebit} >= 0 and ${t.totalCredit} >= 0`),
    check(
      "journal_entries_source_all_or_none_chk",
      sql`(${t.sourceType} is null) = (${t.sourceId} is null) and (${t.sourceType} is null) = (${t.sourceEvent} is null)`,
    ),
    check(
      "journal_entries_reversal_self_chk",
      sql`${t.reversalOfId} is null or ${t.reversalOfId} <> ${t.id}`,
    ),
    check(
      "journal_entries_cancel_fields_chk",
      sql`${t.status} <> 'cancelled' or (${t.cancelledAt} is not null and ${t.reason} is not null)`,
    ),
  ],
);

/**
 * Baris jurnal. Nominal (debit/credit) selalu mata uang dasar numeric(18,2).
 * Kolom mata uang asing (`currency`/`exchangeRate`/`amountForeign`) adalah referensi
 * nullable untuk jejak FX dokumen sumber (pembelian/penjualan) — TIDAK dipakai untuk
 * keseimbangan debit=kredit yang tetap dalam mata uang dasar.
 */
export const journalEntryLines = pgTable(
  "journal_entry_lines",
  {
    id: primaryId(),
    entryId: uuid()
      .notNull()
      .references(() => journalEntries.id),
    lineNo: smallint().notNull(),
    accountId: uuid()
      .notNull()
      .references(() => chartAccounts.id),
    debit: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    credit: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    memo: text(),
    branchId: uuid().references(() => branches.id),
    departmentId: uuid().references(() => departments.id),
    // Dimensi pusat biaya (Tahap 4G). Nullable; hanya diperiksa bila diisi.
    costCenterId: uuid().references(() => costCenters.id),
    // Referensi FX (Tahap 5G): jejak mata uang asing baris sumber; nominal tetap dasar.
    currency: char({ length: 3 }).references(() => currencies.code),
    exchangeRate: numeric({ precision: 18, scale: 6 }),
    amountForeign: numeric({ precision: 18, scale: 2 }),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("journal_entry_lines_entry_line_uq").on(t.entryId, t.lineNo),
    index("journal_entry_lines_account_idx").on(t.accountId, t.entryId),
    index("journal_entry_lines_branch_idx")
      .on(t.branchId)
      .where(sql`${t.branchId} is not null`),
    index("journal_entry_lines_department_idx")
      .on(t.departmentId)
      .where(sql`${t.departmentId} is not null`),
    index("journal_entry_lines_cost_center_idx")
      .on(t.costCenterId)
      .where(sql`${t.costCenterId} is not null`),
    check("journal_entry_lines_line_no_chk", sql`${t.lineNo} >= 1`),
    check(
      "journal_entry_lines_amounts_chk",
      sql`${t.debit} >= 0 and ${t.credit} >= 0 and (${t.debit} = 0 or ${t.credit} = 0) and (${t.debit} + ${t.credit}) > 0`,
    ),
  ],
);