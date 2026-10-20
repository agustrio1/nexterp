import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  char,
  check,
  date,
  index,
  jsonb,
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

export const fiscalYearStatusEnum = pgEnum("fiscal_year_status", ["open", "closed"]);
export const accountingPeriodStatusEnum = pgEnum("accounting_period_status", [
  "open",
  "soft_closed",
  "closed",
]);

/** Single-tenant: hanya boleh ada satu baris (id = 1). */
export const companyProfile = pgTable(
  "company_profile",
  {
    id: smallint().primaryKey().default(1),
    legalName: text().notNull(),
    tradeName: text(),
    taxId: text(),
    address: text(),
    city: text(),
    province: text(),
    postalCode: text(),
    phone: text(),
    email: text(),
    website: text(),
    logoStorageKey: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [check("company_profile_singleton_chk", sql`${t.id} = 1`)],
);

/**
 * Pengaturan key-value. Bentuk value divalidasi oleh Zod di service per key.
 * Key awal (di-seed): base_currency, timezone, costing_method, allow_negative_stock.
 */
export const companySettings = pgTable("company_settings", {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  description: text(),
  updatedBy: uuid().references(() => users.id),
  ...timestamps(),
});

export const currencies = pgTable(
  "currencies",
  {
    code: char({ length: 3 }).primaryKey(),
    name: text().notNull(),
    symbol: text(),
    decimals: smallint().notNull().default(2),
    isActive: boolean().notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    check("currencies_code_upper_chk", sql`${t.code} = upper(${t.code})`),
    check("currencies_decimals_chk", sql`${t.decimals} between 0 and 6`),
  ],
);

/** Kurs historis per tanggal. Baris tidak diubah; kurs baru = baris baru. */
export const exchangeRates = pgTable(
  "exchange_rates",
  {
    id: primaryId(),
    fromCurrency: char({ length: 3 })
      .notNull()
      .references(() => currencies.code),
    toCurrency: char({ length: 3 })
      .notNull()
      .references(() => currencies.code),
    rateDate: date({ mode: "string" }).notNull(),
    rate: numeric({ precision: 18, scale: 6 }).notNull(),
    source: text(),
    createdBy: uuid().references(() => users.id),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("exchange_rates_pair_date_uq").on(t.fromCurrency, t.toCurrency, t.rateDate),
    check("exchange_rates_rate_chk", sql`${t.rate} > 0`),
    check("exchange_rates_pair_chk", sql`${t.fromCurrency} <> ${t.toCurrency}`),
    // Keyset paginasi listExchangeRates (Tahap 10C): urutan kanonik
    // (rate_date, id). Predikat OR pada service (
    //   rate_date < cursor  OR  (rate_date = cursor AND id < cursor)
    // ) memanfaatkan indeks ini lewat dua Branch Index Scan.
    index("exchange_rates_rate_date_id_idx").on(t.rateDate, t.id),
  ],
);

export const branches = pgTable(
  "branches",
  {
    id: primaryId(),
    code: text().notNull().unique(),
    name: text().notNull(),
    address: text(),
    phone: text(),
    isActive: boolean().notNull().default(true),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [check("branches_code_chk", sql`length(trim(${t.code})) > 0`)],
);

export const departments = pgTable(
  "departments",
  {
    id: primaryId(),
    code: text().notNull().unique(),
    name: text().notNull(),
    parentId: uuid().references((): AnyPgColumn => departments.id),
    // NULL = departemen berlaku untuk seluruh perusahaan.
    branchId: uuid().references(() => branches.id),
    isActive: boolean().notNull().default(true),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("departments_parent_idx").on(t.parentId),
    index("departments_branch_idx").on(t.branchId),
    check("departments_parent_chk", sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
  ],
);

export const fiscalYears = pgTable(
  "fiscal_years",
  {
    id: primaryId(),
    code: text().notNull().unique(),
    startDate: date({ mode: "string" }).notNull(),
    endDate: date({ mode: "string" }).notNull(),
    status: fiscalYearStatusEnum().notNull().default("open"),
    closedAt: timestamptz(),
    closedBy: uuid().references(() => users.id),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [check("fiscal_years_range_chk", sql`${t.endDate} > ${t.startDate}`)],
);

/** period_no 1..12 = periode reguler, 13 = periode penyesuaian akhir tahun (boleh berbagi tanggal). */
export const accountingPeriods = pgTable(
  "accounting_periods",
  {
    id: primaryId(),
    fiscalYearId: uuid()
      .notNull()
      .references(() => fiscalYears.id),
    periodNo: smallint().notNull(),
    startDate: date({ mode: "string" }).notNull(),
    endDate: date({ mode: "string" }).notNull(),
    status: accountingPeriodStatusEnum().notNull().default("open"),
    closedAt: timestamptz(),
    closedBy: uuid().references(() => users.id),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("accounting_periods_year_no_uq").on(t.fiscalYearId, t.periodNo),
    index("accounting_periods_dates_idx").on(t.startDate, t.endDate),
    check("accounting_periods_no_chk", sql`${t.periodNo} between 1 and 13`),
    check("accounting_periods_range_chk", sql`${t.endDate} >= ${t.startDate}`),
  ],
);