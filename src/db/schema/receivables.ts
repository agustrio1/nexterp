import { sql } from "drizzle-orm";
import {
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
import { branches, currencies } from "./organization";
import { products } from "./inventory";
import { customers } from "./crm";
import { journalEntries } from "./accounting";
import { bankAccounts } from "./finance";
import { taxTransactions } from "./finance";
import { salesDeliveryLines, salesDeliveries } from "./sales";

/* ------------------------------------------------------------------ */
/* Tahap 6D: Piutang usaha (AR) + kredit note + pembayaran customer    */
/* ------------------------------------------------------------------ */
// Faktur penjualan (merujuk delivery — "no off-SO invoice"), pembayaran customer
// + alokasi FIFO, dan nota kredit penjualan yang mengurangi AR.
// docNo: draft/cancelled→null; posted/reversed→not-null (mirip AP).

/* ----------------------------- Enums ----------------------------- */

export const customerInvoiceStatusEnum = pgEnum("customer_invoice_status", [
  "draft",
  "posted",
  "cancelled",
  "reversed",
]);

export const customerPaymentStatusEnum = pgEnum("customer_payment_status", [
  "draft",
  "posted",
  "cancelled",
  "reversed",
]);

export const salesCreditNoteStatusEnum = pgEnum("sales_credit_note_status", [
  "draft",
  "posted",
  "cancelled",
  "reversed",
]);

/* ------------------------ Customer Invoice ------------------------ */

/**
 * Faktur penjualan. WAJIB merujuk delivery (no off-SO invoice). PPN dicatat
 * via taxTransactionId saat posting. Jurnal: Dr AR / Cr Revenue + Cr TaxPayable.
 */
export const customerInvoices = pgTable(
  "customer_invoices",
  {
    id: primaryId(),
    docNo: text().unique(),
    status: customerInvoiceStatusEnum().notNull().default("draft"),
    deliveryId: uuid()
      .notNull()
      .references(() => salesDeliveries.id),
    customerId: uuid()
      .notNull()
      .references(() => customers.id),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    invoiceDate: date({ mode: "string" }).notNull(),
    dueDate: date({ mode: "string" }).notNull(),
    currency: char({ length: 3 })
      .notNull()
      .references(() => currencies.code),
    exchangeRate: numeric({ precision: 18, scale: 6 }),
    subtotalForeign: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    taxForeign: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    totalForeign: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    subtotalBase: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    taxBase: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    totalBase: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    amountPaid: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    journalEntryId: uuid().references(() => journalEntries.id),
    taxTransactionId: uuid().references(() => taxTransactions.id),
    notes: text(),
    postedAt: timestamptz(),
    cancelledAt: timestamptz(),
    reversedAt: timestamptz(),
    reason: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("customer_invoices_delivery_idx").on(t.deliveryId),
    index("customer_invoices_customer_idx").on(t.customerId),
    index("customer_invoices_branch_date_idx").on(t.branchId, t.invoiceDate),
    index("customer_invoices_status_due_idx").on(t.status, t.dueDate),
    check(
      "customer_invoices_docno_chk",
      sql`(${t.status} in ('draft', 'cancelled') and ${t.docNo} is null) or (${t.status} in ('posted', 'reversed') and ${t.docNo} is not null)`,
    ),
    check(
      "customer_invoices_posted_chk",
      sql`${t.status} <> 'posted' or (${t.exchangeRate} is not null and ${t.exchangeRate} > 0 and ${t.totalBase} > 0 and ${t.journalEntryId} is not null)`,
    ),
    check(
      "customer_invoices_currency_chk",
      sql`${t.currency} = upper(${t.currency}) and length(${t.currency}) = 3`,
    ),
    check("customer_invoices_dates_chk", sql`${t.dueDate} >= ${t.invoiceDate}`),
    check(
      "customer_invoices_cancel_chk",
      sql`${t.status} <> 'cancelled' or (${t.cancelledAt} is not null and ${t.reason} is not null)`,
    ),
    check(
      "customer_invoices_reverse_chk",
      sql`${t.status} <> 'reversed' or (${t.reversedAt} is not null and ${t.reason} is not null)`,
    ),
    check(
      "customer_invoices_total_chk",
      sql`${t.totalForeign} = ${t.subtotalForeign} + ${t.taxForeign}`,
    ),
  ],
);

/**
 * Baris faktur. Merujuk delivery line untuk qty tagih (menagih <= qty kirim).
 */
export const customerInvoiceLines = pgTable(
  "customer_invoice_lines",
  {
    id: primaryId(),
    invoiceId: uuid()
      .notNull()
      .references(() => customerInvoices.id, { onDelete: "cascade" }),
    lineNo: smallint().notNull(),
    deliveryLineId: uuid()
      .notNull()
      .references(() => salesDeliveryLines.id),
    productId: uuid().references(() => products.id),
    description: text(),
    quantity: numeric({ precision: 18, scale: 3 }).notNull(),
    unitPrice: numeric({ precision: 18, scale: 4 }).notNull(),
    amountForeign: numeric({ precision: 18, scale: 2 }).notNull(),
    amountBase: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    taxAmount: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("customer_invoice_lines_inv_line_uq").on(t.invoiceId, t.lineNo),
    index("customer_invoice_lines_delivery_line_idx").on(t.deliveryLineId),
    check("customer_invoice_lines_line_no_chk", sql`${t.lineNo} >= 1`),
    check("customer_invoice_lines_qty_chk", sql`${t.quantity} > 0`),
    check("customer_invoice_lines_price_chk", sql`${t.unitPrice} >= 0`),
    check("customer_invoice_lines_amount_chk", sql`${t.amountForeign} >= 0 and ${t.amountBase} >= 0`),
  ],
);

/* ------------------------ Customer Payment ------------------------ */

/**
 * Pembayaran customer (CMP). Bank/cash account tujuan (`bankAccountId`) menentukan debit jurnal.
 * Jurnal: Dr Bank / Cr AR. Alokasi ke invoice pada customer_payment_allocations.
 */
export const customerPayments = pgTable(
  "customer_payments",
  {
    id: primaryId(),
    docNo: text().unique(),
    status: customerPaymentStatusEnum().notNull().default("draft"),
    customerId: uuid()
      .notNull()
      .references(() => customers.id),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    paymentDate: date({ mode: "string" }).notNull(),
    currency: char({ length: 3 })
      .notNull()
      .references(() => currencies.code),
    exchangeRate: numeric({ precision: 18, scale: 6 }),
    amountForeign: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    amountBase: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    bankAccountId: uuid()
      .notNull()
      .references(() => bankAccounts.id),
    journalEntryId: uuid().references(() => journalEntries.id),
    memo: text(),
    postedAt: timestamptz(),
    cancelledAt: timestamptz(),
    reversedAt: timestamptz(),
    reason: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("customer_payments_customer_idx").on(t.customerId),
    index("customer_payments_status_date_idx").on(t.status, t.paymentDate),
    check(
      "customer_payments_docno_chk",
      sql`(${t.status} in ('draft', 'cancelled') and ${t.docNo} is null) or (${t.status} in ('posted', 'reversed') and ${t.docNo} is not null)`,
    ),
    check(
      "customer_payments_posted_chk",
      sql`${t.status} <> 'posted' or (${t.exchangeRate} is not null and ${t.exchangeRate} > 0 and ${t.amountBase} > 0 and ${t.journalEntryId} is not null)`,
    ),
    check(
      "customer_payments_currency_chk",
      sql`${t.currency} = upper(${t.currency}) and length(${t.currency}) = 3`,
    ),
    check("customer_payments_amount_chk", sql`${t.amountForeign} >= 0 and ${t.amountBase} >= 0`),
    check(
      "customer_payments_cancel_chk",
      sql`${t.status} <> 'cancelled' or (${t.cancelledAt} is not null and ${t.reason} is not null)`,
    ),
    check(
      "customer_payments_reverse_chk",
      sql`${t.status} <> 'reversed' or (${t.reversedAt} is not null and ${t.reason} is not null)`,
    ),
  ],
);

/** Alokasi pembayaran ke invoice (FIFO). Satu payment bisa alokasi ke banyak invoice. */
export const customerPaymentAllocations = pgTable(
  "customer_payment_allocations",
  {
    id: primaryId(),
    paymentId: uuid()
      .notNull()
      .references(() => customerPayments.id, { onDelete: "cascade" }),
    invoiceId: uuid()
      .notNull()
      .references(() => customerInvoices.id),
    amountBase: numeric({ precision: 18, scale: 2 }).notNull(),
    amountForeign: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("customer_payment_allocations_payment_invoice_uq").on(t.paymentId, t.invoiceId),
    index("customer_payment_allocations_invoice_idx").on(t.invoiceId),
    check("customer_payment_allocations_amount_chk", sql`${t.amountBase} > 0`),
  ],
);

/* --------------------------- Credit Note --------------------------- */

/**
 * Nota kredit penjualan (CN). Merujuk invoice (mengurangi AR).
 * Saat posting: Dr Revenue + Dr TaxPayable / Cr AR.
 */
export const salesCreditNotes = pgTable(
  "sales_credit_notes",
  {
    id: primaryId(),
    docNo: text().unique(),
    status: salesCreditNoteStatusEnum().notNull().default("draft"),
    invoiceId: uuid()
      .notNull()
      .references(() => customerInvoices.id),
    customerId: uuid()
      .notNull()
      .references(() => customers.id),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    creditNoteDate: date({ mode: "string" }).notNull(),
    currency: char({ length: 3 })
      .notNull()
      .references(() => currencies.code),
    exchangeRate: numeric({ precision: 18, scale: 6 }),
    totalForeign: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    totalBase: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    journalEntryId: uuid().references(() => journalEntries.id),
    reason: text(),
    postedAt: timestamptz(),
    cancelledAt: timestamptz(),
    reversedAt: timestamptz(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("sales_credit_notes_invoice_idx").on(t.invoiceId),
    index("sales_credit_notes_customer_idx").on(t.customerId),
    index("sales_credit_notes_status_date_idx").on(t.status, t.creditNoteDate),
    check(
      "sales_credit_notes_docno_chk",
      sql`(${t.status} in ('draft', 'cancelled') and ${t.docNo} is null) or (${t.status} in ('posted', 'reversed') and ${t.docNo} is not null)`,
    ),
    check(
      "sales_credit_notes_posted_chk",
      sql`${t.status} <> 'posted' or (${t.journalEntryId} is not null and ${t.totalBase} > 0)`,
    ),
    check(
      "sales_credit_notes_currency_chk",
      sql`${t.currency} = upper(${t.currency}) and length(${t.currency}) = 3`,
    ),
    check(
      "sales_credit_notes_cancel_chk",
      sql`${t.status} <> 'cancelled' or (${t.cancelledAt} is not null and ${t.reason} is not null)`,
    ),
    check(
      "sales_credit_notes_reverse_chk",
      sql`${t.status} <> 'reversed' or (${t.reversedAt} is not null and ${t.reason} is not null)`,
    ),
  ],
);

export const salesCreditNoteLines = pgTable(
  "sales_credit_note_lines",
  {
    id: primaryId(),
    creditNoteId: uuid()
      .notNull()
      .references(() => salesCreditNotes.id, { onDelete: "cascade" }),
    lineNo: smallint().notNull(),
    invoiceLineId: uuid().references(() => customerInvoiceLines.id),
    productId: uuid().references(() => products.id),
    description: text(),
    quantity: numeric({ precision: 18, scale: 3 }).notNull(),
    unitPrice: numeric({ precision: 18, scale: 4 }).notNull(),
    amountForeign: numeric({ precision: 18, scale: 2 }).notNull(),
    amountBase: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("sales_credit_note_lines_cn_line_uq").on(t.creditNoteId, t.lineNo),
    check("sales_credit_note_lines_line_no_chk", sql`${t.lineNo} >= 1`),
    check("sales_credit_note_lines_qty_chk", sql`${t.quantity} > 0`),
    check("sales_credit_note_lines_price_chk", sql`${t.unitPrice} >= 0`),
  ],
);

/* -------- Exported types -------- */

export type CustomerInvoiceStatus = (typeof customerInvoiceStatusEnum.enumValues)[number];
export type CustomerPaymentStatus = (typeof customerPaymentStatusEnum.enumValues)[number];
export type SalesCreditNoteStatus = (typeof salesCreditNoteStatusEnum.enumValues)[number];
