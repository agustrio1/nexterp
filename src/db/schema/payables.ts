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
import { journalEntries } from "./accounting";
import { bankAccounts } from "./finance";
import { purchaseOrderLines, purchaseOrders, suppliers } from "./procurement";

/* ------------------------------------------------------------------ */
/* Tahap 5G: Utang usaha (AP) + jurnal GR/IR perpetual                 */
/* ------------------------------------------------------------------ */
// Invoice pemasok (three-way match ke PO + baris PO), pembayaran AP + alokasi FIFO.
// Nilai uang selalu string desimal lewat src/lib/money.ts; nominal jurnal dalam mata
// uang dasar. FX (currency/exchangeRate/amountForeign) adalah referensi pada subledger.

/** Status invoice pemasok. */
export const supplierInvoiceStatusEnum = pgEnum("supplier_invoice_status", [
  "draft",
  "posted",
  "cancelled",
  "reversed",
]);

/** Status pembayaran AP. */
export const apPaymentStatusEnum = pgEnum("ap_payment_status", [
  "draft",
  "posted",
  "cancelled",
  "reversed",
]);

/**
 * Invoice pemasok. WAJIB merujuk PO (three-way match scope procurement). Nilai
 * `totalForeign` dalam mata uang invoice; `totalBase` hasil snapshot kurs saat post.
 * `journalEntryId` diisi saat posting (Dr GR/IR / Cr AP).
 */
export const supplierInvoices = pgTable(
  "supplier_invoices",
  {
    id: primaryId(),
    docNo: text().unique(),
    status: supplierInvoiceStatusEnum().notNull().default("draft"),
    supplierId: uuid()
      .notNull()
      .references(() => suppliers.id),
    poId: uuid()
      .notNull()
      .references(() => purchaseOrders.id),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    invoiceDate: date({ mode: "string" }).notNull(),
    dueDate: date({ mode: "string" }).notNull(),
    currency: char({ length: 3 })
      .notNull()
      .references(() => currencies.code),
    exchangeRate: numeric({ precision: 18, scale: 6 }),
    totalForeign: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    totalBase: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    journalEntryId: uuid().references(() => journalEntries.id),
    notes: text(),
    postedAt: timestamptz(),
    cancelledAt: timestamptz(),
    reversedAt: timestamptz(),
    reason: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("supplier_invoices_supplier_idx").on(t.supplierId),
    index("supplier_invoices_po_idx").on(t.poId),
    index("supplier_invoices_status_due_idx").on(t.status, t.dueDate),
    check(
      "supplier_invoices_docno_chk",
      sql`(${t.status} in ('draft', 'cancelled') and ${t.docNo} is null) or (${t.status} in ('posted', 'reversed') and ${t.docNo} is not null)`,
    ),
    check(
      "supplier_invoices_posted_chk",
      sql`${t.status} <> 'posted' or (${t.exchangeRate} is not null and ${t.exchangeRate} > 0 and ${t.totalBase} > 0 and ${t.journalEntryId} is not null)`,
    ),
    check(
      "supplier_invoices_currency_chk",
      sql`${t.currency} = upper(${t.currency}) and length(${t.currency}) = 3`,
    ),
    check("supplier_invoices_dates_chk", sql`${t.dueDate} >= ${t.invoiceDate}`),
    check(
      "supplier_invoices_cancel_chk",
      sql`${t.status} <> 'cancelled' or (${t.cancelledAt} is not null and ${t.reason} is not null)`,
    ),
    check(
      "supplier_invoices_reverse_chk",
      sql`${t.status} <> 'reversed' or (${t.reversedAt} is not null and ${t.reason} is not null)`,
    ),
  ],
);

/**
 * Baris invoice. Masing-masing wajib menempel ke satu baris PO (`poLineId`) untuk
 * three-way match; qty menagih <= qty diterima (dijaga service). Nominal foreign dari
 * `unitPrice` invoice; `amountBase` dari snapshot kurs saat post.
 */
export const supplierInvoiceLines = pgTable(
  "supplier_invoice_lines",
  {
    id: primaryId(),
    invoiceId: uuid()
      .notNull()
      .references(() => supplierInvoices.id, { onDelete: "cascade" }),
    lineNo: smallint().notNull(),
    poLineId: uuid()
      .notNull()
      .references(() => purchaseOrderLines.id),
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
    uniqueIndex("supplier_invoice_lines_invoice_line_uq").on(t.invoiceId, t.lineNo),
    index("supplier_invoice_lines_po_line_idx").on(t.poLineId),
    check("supplier_invoice_lines_line_no_chk", sql`${t.lineNo} >= 1`),
    check("supplier_invoice_lines_qty_chk", sql`${t.quantity} > 0`),
    check("supplier_invoice_lines_price_chk", sql`${t.unitPrice} >= 0`),
    check(
      "supplier_invoice_lines_amount_chk",
      sql`${t.amountForeign} >= 0 and ${t.amountBase} >= 0`,
    ),
  ],
);

/**
 * Pembayaran AP. Bank/cash account tujuan (`bankAccountId`) menentukan kredit jurnal.
 * `amountBase` hasil snapshot kurs `paymentDate`. Alokasi ke invoice pada
 * `ap_payment_allocations`. Jurnal Dr AP / Cr Bank dibuat saat post.
 */
export const apPayments = pgTable(
  "ap_payments",
  {
    id: primaryId(),
    docNo: text().unique(),
    status: apPaymentStatusEnum().notNull().default("draft"),
    supplierId: uuid()
      .notNull()
      .references(() => suppliers.id),
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
    index("ap_payments_supplier_idx").on(t.supplierId),
    index("ap_payments_status_date_idx").on(t.status, t.paymentDate),
    check(
      "ap_payments_docno_chk",
      sql`(${t.status} in ('draft', 'cancelled') and ${t.docNo} is null) or (${t.status} in ('posted', 'reversed') and ${t.docNo} is not null)`,
    ),
    check(
      "ap_payments_posted_chk",
      sql`${t.status} <> 'posted' or (${t.exchangeRate} is not null and ${t.exchangeRate} > 0 and ${t.amountBase} > 0 and ${t.journalEntryId} is not null)`,
    ),
    check(
      "ap_payments_currency_chk",
      sql`${t.currency} = upper(${t.currency}) and length(${t.currency}) = 3`,
    ),
    check("ap_payments_amount_chk", sql`${t.amountForeign} >= 0 and ${t.amountBase} >= 0`),
    check(
      "ap_payments_cancel_chk",
      sql`${t.status} <> 'cancelled' or (${t.cancelledAt} is not null and ${t.reason} is not null)`,
    ),
    check(
      "ap_payments_reverse_chk",
      sql`${t.status} <> 'reversed' or (${t.reversedAt} is not null and ${t.reason} is not null)`,
    ),
  ],
);

/** Alokasi satu pembayaran ke satu invoice (banyak-ke-banyak lewat baris ini). */
export const apPaymentAllocations = pgTable(
  "ap_payment_allocations",
  {
    id: primaryId(),
    paymentId: uuid()
      .notNull()
      .references(() => apPayments.id, { onDelete: "cascade" }),
    invoiceId: uuid()
      .notNull()
      .references(() => supplierInvoices.id),
    amountBase: numeric({ precision: 18, scale: 2 }).notNull(),
    amountForeign: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("ap_payment_allocations_payment_invoice_uq").on(t.paymentId, t.invoiceId),
    index("ap_payment_allocations_invoice_idx").on(t.invoiceId),
    check("ap_payment_allocations_amount_chk", sql`${t.amountBase} > 0`),
  ],
);

/** Tipe status untuk service/skema 5G. */
export type SupplierInvoiceStatus = (typeof supplierInvoiceStatusEnum.enumValues)[number];
export type ApPaymentStatus = (typeof apPaymentStatusEnum.enumValues)[number];
