import { sql } from "drizzle-orm";
import {
  boolean,
  char,
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
import { currencies } from "./organization";
import { products } from "./inventory";
import { paymentTerms } from "./procurement";
import { users } from "./identity";

/* ------------------------------------------------------------------ */
/* Tahap 6B: CRM (accounts, contacts, leads, pipeline, opportunities,  */
/*           activities, tasks, notes, segments, customers, price list) */
/* ------------------------------------------------------------------ */
// Data CRM bersifat master sederhana: dinonaktifkan, tidak dihapus. Tidak ada
// trigger imutabilitas karena entitas CRM boleh berubah sepanjang lifecycle.

/* ----------------------------- Enums ------------------------------ */

export const crmAccountTypeEnum = pgEnum("crm_account_type", [
  "prospect",
  "customer",
  "partner",
]);

export const crmLeadStatusEnum = pgEnum("crm_lead_status", [
  "new",
  "contacted",
  "qualified",
  "converted",
  "discarded",
]);

export const crmOpportunityStatusEnum = pgEnum("crm_opportunity_status", [
  "open",
  "won",
  "lost",
]);

export const crmActivityTypeEnum = pgEnum("crm_activity_type", [
  "call",
  "email",
  "meeting",
  "task",
  "other",
]);

export const crmTaskStatusEnum = pgEnum("crm_task_status", [
  "pending",
  "completed",
  "overdue",
]);

/* --------------------------- Tabel CRM ----------------------------- */

/** Akun CRM: entitas bisnis (prospek, pelanggan, mitra). */
export const crmAccounts = pgTable(
  "crm_accounts",
  {
    id: primaryId(),
    code: text().notNull(),
    name: text().notNull(),
    type: crmAccountTypeEnum().notNull().default("prospect"),
    taxId: text(),
    address: text(),
    city: text(),
    province: text(),
    country: text(),
    phone: text(),
    email: text(),
    website: text(),
    notes: text(),
    isActive: boolean().notNull().default(true),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("crm_accounts_code_uq").on(t.code),
    index("crm_accounts_type_idx").on(t.type),
    index("crm_accounts_active_idx").on(t.isActive),
    check("crm_accounts_code_chk", sql`length(trim(${t.code})) > 0`),
    check("crm_accounts_name_chk", sql`length(trim(${t.name})) > 0`),
  ],
);

/** Kontak person pada akun CRM. */
export const crmContacts = pgTable(
  "crm_contacts",
  {
    id: primaryId(),
    accountId: uuid().notNull().references(() => crmAccounts.id),
    name: text().notNull(),
    title: text(),
    email: text(),
    phone: text(),
    isPrimary: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("crm_contacts_account_idx").on(t.accountId),
    uniqueIndex("crm_contacts_email_uq").on(t.accountId, t.email).where(sql`${t.email} IS NOT NULL`),
    check("crm_contacts_name_chk", sql`length(trim(${t.name})) > 0`),
  ],
);

/** Prospek (lead) sebelum menjadi akun. */
export const crmLeads = pgTable(
  "crm_leads",
  {
    id: primaryId(),
    name: text().notNull(),
    source: text(),
    status: crmLeadStatusEnum().notNull().default("new"),
    contactName: text(),
    email: text(),
    phone: text(),
    company: text(),
    convertedAccountId: uuid().references(() => crmAccounts.id),
    convertedContactId: uuid().references(() => crmContacts.id),
    assignedTo: uuid().references(() => users.id),
    notes: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("crm_leads_status_idx").on(t.status),
    index("crm_leads_assigned_idx").on(t.assignedTo),
    check("crm_leads_name_chk", sql`length(trim(${t.name})) > 0`),
    check("crm_leads_converted_chk", sql`(
      ${t.status} != 'converted'
      OR (${t.convertedAccountId} IS NOT NULL)
    )`),
  ],
);

/** Tahap pipeline untuk peluang penjualan. */
export const crmPipelineStages = pgTable(
  "crm_pipeline_stages",
  {
    id: primaryId(),
    name: text().notNull(),
    position: integer().notNull(),
    probability: numeric({ precision: 5, scale: 2 }).notNull().default("0"),
    isActive: boolean().notNull().default(true),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("crm_pipeline_stages_position_uq").on(t.position),
    check("crm_pipeline_stages_name_chk", sql`length(trim(${t.name})) > 0`),
    check("crm_pipeline_stages_prob_chk", sql`${t.probability} >= 0 AND ${t.probability} <= 100`),
    check("crm_pipeline_stages_pos_chk", sql`${t.position} >= 1`),
  ],
);

/** Peluang (opportunity) dalam pipeline. */
export const crmOpportunities = pgTable(
  "crm_opportunities",
  {
    id: primaryId(),
    accountId: uuid().notNull().references(() => crmAccounts.id),
    leadId: uuid().references(() => crmLeads.id),
    title: text().notNull(),
    stageId: uuid().notNull().references(() => crmPipelineStages.id),
    status: crmOpportunityStatusEnum().notNull().default("open"),
    amount: numeric({ precision: 18, scale: 2 }),
    currency: char({ length: 3 }).references(() => currencies.code),
    expectedCloseDate: date(),
    assignedTo: uuid().references(() => users.id),
    probability: numeric({ precision: 5, scale: 2 }),
    isActive: boolean().notNull().default(true),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("crm_opportunities_account_idx").on(t.accountId),
    index("crm_opportunities_stage_idx").on(t.stageId),
    index("crm_opportunities_status_idx").on(t.status),
    check("crm_opportunities_title_chk", sql`length(trim(${t.title})) > 0`),
    check("crm_opportunities_currency_chk", sql`${t.currency} IS NULL OR ${t.currency} = upper(${t.currency})`),
  ],
);

/** Aktivitas CRM (telepon, email, meeting, dll). */
export const crmActivities = pgTable(
  "crm_activities",
  {
    id: primaryId(),
    accountId: uuid().references(() => crmAccounts.id),
    contactId: uuid().references(() => crmContacts.id),
    leadId: uuid().references(() => crmLeads.id),
    opportunityId: uuid().references(() => crmOpportunities.id),
    type: crmActivityTypeEnum().notNull(),
    subject: text().notNull(),
    description: text(),
    activityDate: timestamptz().notNull().defaultNow(),
    assignedTo: uuid().references(() => users.id),
    isCompleted: boolean().notNull().default(false),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("crm_activities_account_idx").on(t.accountId),
    index("crm_activities_type_idx").on(t.type),
    index("crm_activities_date_idx").on(t.activityDate),
    check("crm_activities_subject_chk", sql`length(trim(${t.subject})) > 0`),
  ],
);

/** Tugas CRM dengan jatuh tempo. */
export const crmTasks = pgTable(
  "crm_tasks",
  {
    id: primaryId(),
    accountId: uuid().references(() => crmAccounts.id),
    opportunityId: uuid().references(() => crmOpportunities.id),
    title: text().notNull(),
    description: text(),
    dueDate: date(),
    status: crmTaskStatusEnum().notNull().default("pending"),
    assignedTo: uuid().references(() => users.id),
    isCompleted: boolean().notNull().default(false),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("crm_tasks_account_idx").on(t.accountId),
    index("crm_tasks_due_idx").on(t.dueDate),
    index("crm_tasks_status_idx").on(t.status),
    check("crm_tasks_title_chk", sql`length(trim(${t.title})) > 0`),
  ],
);

/** Catatan bebas pada akun/kontak/opportunity. */
export const crmNotes = pgTable(
  "crm_notes",
  {
    id: primaryId(),
    accountId: uuid().references(() => crmAccounts.id),
    contactId: uuid().references(() => crmContacts.id),
    opportunityId: uuid().references(() => crmOpportunities.id),
    content: text().notNull(),
    authorId: uuid().notNull().references(() => users.id),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("crm_notes_account_idx").on(t.accountId),
    index("crm_notes_author_idx").on(t.authorId),
    check("crm_notes_content_chk", sql`length(trim(${t.content})) > 0`),
  ],
);

/** Segmen untuk klasifikasi akun. */
export const crmSegments = pgTable(
  "crm_segments",
  {
    id: primaryId(),
    name: text().notNull(),
    description: text(),
    criteria: jsonb(),
    isActive: boolean().notNull().default(true),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("crm_segments_name_uq").on(t.name),
    check("crm_segments_name_chk", sql`length(trim(${t.name})) > 0`),
  ],
);

/** Relasi M2M akun-ke-segmen. */
export const crmAccountSegments = pgTable(
  "crm_account_segments",
  {
    accountId: uuid().notNull().references(() => crmAccounts.id),
    segmentId: uuid().notNull().references(() => crmSegments.id),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("crm_account_segments_pk").on(t.accountId, t.segmentId),
  ],
);

/* ------------------------ Daftar harga ----------------------------- */

/** Header daftar harga (price list). */
export const priceLists = pgTable(
  "price_lists",
  {
    id: primaryId(),
    code: text().notNull(),
    name: text().notNull(),
    validFrom: date().notNull(),
    validTo: date(),
    isActive: boolean().notNull().default(true),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("price_lists_code_uq").on(t.code),
    index("price_lists_active_idx").on(t.isActive),
    check("price_lists_code_chk", sql`length(trim(${t.code})) > 0`),
    check("price_lists_name_chk", sql`length(trim(${t.name})) > 0`),
    check("price_lists_valid_chk", sql`${t.validTo} IS NULL OR ${t.validTo} >= ${t.validFrom}`),
  ],
);

/** Item harga per produk dalam daftar harga. */
export const priceListItems = pgTable(
  "price_list_items",
  {
    id: primaryId(),
    priceListId: uuid().notNull().references(() => priceLists.id, { onDelete: "cascade" }),
    productId: uuid().notNull().references(() => products.id),
    unitPrice: numeric({ precision: 18, scale: 4 }).notNull(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("price_list_items_list_product_uq").on(t.priceListId, t.productId),
    index("price_list_items_product_idx").on(t.productId),
    check("price_list_items_price_chk", sql`${t.unitPrice} >= 0`),
  ],
);

/* ------------------------- Pelanggan (customers) -------------------- */

/**
 * Pelanggan: ekstensi 1:1 dari crm_accounts untuk entitas yang aktif bertransaksi
 * penjualan. Menyimpan batas kredit, termin pembayaran, dan daftar harga default.
 */
export const customers = pgTable(
  "customers",
  {
    id: primaryId(),
    crmAccountId: uuid().notNull().references(() => crmAccounts.id),
    code: text().notNull(),
    creditLimit: numeric({ precision: 18, scale: 2 }),
    paymentTermsId: uuid().references(() => paymentTerms.id),
    priceListId: uuid().references(() => priceLists.id),
    currency: char({ length: 3 })
      .notNull()
      .default("IDR")
      .references(() => currencies.code),
    isActive: boolean().notNull().default(true),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("customers_crm_account_uq").on(t.crmAccountId),
    uniqueIndex("customers_code_uq").on(t.code),
    index("customers_active_idx").on(t.isActive),
    check("customers_code_chk", sql`length(trim(${t.code})) > 0`),
    check("customers_currency_chk", sql`${t.currency} = upper(${t.currency}) and length(${t.currency}) = 3`),
    check("customers_credit_chk", sql`${t.creditLimit} IS NULL OR ${t.creditLimit} >= 0`),
  ],
);
