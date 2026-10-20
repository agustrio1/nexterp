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
import { products, warehouses } from "./inventory";
import { customers } from "./crm";
import { journalEntries } from "./accounting";

/* ------------------------------------------------------------------ */
/* Tahap 6D: Dokumen penjualan (quotation, SO, delivery, return, CN)  */
/* ------------------------------------------------------------------ */
// Siklus: SQ (quotation) → SO (sales order) → DLV (delivery) → INV (invoice) → CMP (payment).
// Rantai FK: delivery→SO, invoice→delivery (no off-SO invoice), creditNote→invoice, return→delivery.
// docNo: draft/cancelled→null; posted/reversed→not-null (mirip AP).
// Nilai uang/qty string desimal via src/lib/money.ts; kolom numeric hanya simpan final.

/* ----------------------------- Enums ----------------------------- */

export const salesQuotationStatusEnum = pgEnum("sales_quotation_status", [
  "draft",
  "sent",
  "accepted",
  "rejected",
  "expired",
  "cancelled",
]);

export const salesOrderStatusEnum = pgEnum("sales_order_status", [
  "draft",
  "pending_approval",
  "approved",
  "posted",
  "cancelled",
]);

export const salesDeliveryStatusEnum = pgEnum("sales_delivery_status", [
  "draft",
  "posted",
  "cancelled",
  "reversed",
]);

export const salesReturnStatusEnum = pgEnum("sales_return_status", [
  "draft",
  "posted",
  "cancelled",
  "reversed",
]);

/* --------------------------- Quotation --------------------------- */

export const salesQuotations = pgTable(
  "sales_quotations",
  {
    id: primaryId(),
    docNo: text().unique(),
    status: salesQuotationStatusEnum().notNull().default("draft"),
    customerId: uuid()
      .notNull()
      .references(() => customers.id),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    quotationDate: date({ mode: "string" }).notNull(),
    validUntil: date({ mode: "string" }),
    currency: char({ length: 3 })
      .notNull()
      .references(() => currencies.code),
    exchangeRate: numeric({ precision: 18, scale: 6 }),
    totalBase: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    description: text(),
    notes: text(),
    cancelledAt: timestamptz(),
    reason: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("sales_quotations_customer_idx").on(t.customerId),
    index("sales_quotations_branch_date_idx").on(t.branchId, t.quotationDate),
    index("sales_quotations_status_idx").on(t.status, t.quotationDate),
    check(
      "sales_quotations_docno_chk",
      sql`${t.docNo} is null`,
    ),
    check(
      "sales_quotations_currency_chk",
      sql`${t.currency} = upper(${t.currency}) and length(${t.currency}) = 3`,
    ),
    check(
      "sales_quotations_cancel_chk",
      sql`${t.status} <> 'cancelled' or (${t.cancelledAt} is not null and ${t.reason} is not null)`,
    ),
  ],
);

export const salesQuotationLines = pgTable(
  "sales_quotation_lines",
  {
    id: primaryId(),
    quotationId: uuid()
      .notNull()
      .references(() => salesQuotations.id, { onDelete: "cascade" }),
    lineNo: smallint().notNull(),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    description: text(),
    quantity: numeric({ precision: 18, scale: 3 }).notNull(),
    unitPrice: numeric({ precision: 18, scale: 4 }).notNull(),
    amountForeign: numeric({ precision: 18, scale: 2 }).notNull(),
    baseAmount: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("sales_quotation_lines_sq_line_uq").on(t.quotationId, t.lineNo),
    index("sales_quotation_lines_product_idx").on(t.productId),
    check("sales_quotation_lines_line_no_chk", sql`${t.lineNo} >= 1`),
    check("sales_quotation_lines_qty_chk", sql`${t.quantity} > 0`),
    check("sales_quotation_lines_price_chk", sql`${t.unitPrice} >= 0`),
    check("sales_quotation_lines_amount_chk", sql`${t.amountForeign} >= 0 and ${t.baseAmount} >= 0`),
  ],
);

/* --------------------------- Sales Order -------------------------- */

export const salesOrders = pgTable(
  "sales_orders",
  {
    id: primaryId(),
    docNo: text().unique(),
    status: salesOrderStatusEnum().notNull().default("draft"),
    quotationId: uuid().references(() => salesQuotations.id),
    customerId: uuid()
      .notNull()
      .references(() => customers.id),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    orderDate: date({ mode: "string" }).notNull(),
    expectedDate: date({ mode: "string" }),
    currency: char({ length: 3 })
      .notNull()
      .references(() => currencies.code),
    exchangeRate: numeric({ precision: 18, scale: 6 }),
    totalBase: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    description: text(),
    notes: text(),
    approvedAt: timestamptz(),
    postedAt: timestamptz(),
    cancelledAt: timestamptz(),
    reason: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("sales_orders_customer_idx").on(t.customerId),
    index("sales_orders_branch_date_idx").on(t.branchId, t.orderDate),
    index("sales_orders_status_idx").on(t.status, t.orderDate),
    index("sales_orders_quotation_idx").on(t.quotationId),
    check(
      "sales_orders_docno_chk",
      sql`(${t.status} = 'posted' and ${t.docNo} is not null) or (${t.status} <> 'posted' and ${t.docNo} is null)`,
    ),
    check(
      "sales_orders_posted_rate_chk",
      sql`${t.status} <> 'posted' or (${t.exchangeRate} is not null and ${t.exchangeRate} > 0)`,
    ),
    check(
      "sales_orders_currency_chk",
      sql`${t.currency} = upper(${t.currency}) and length(${t.currency}) = 3`,
    ),
    check(
      "sales_orders_cancel_chk",
      sql`${t.status} <> 'cancelled' or (${t.cancelledAt} is not null and ${t.reason} is not null)`,
    ),
  ],
);

/**
 * Baris SO. `quantityDelivered` dikelola service delivery (tidak diubah manual).
 * Credit limit divalidasi service saat SO post.
 */
export const salesOrderLines = pgTable(
  "sales_order_lines",
  {
    id: primaryId(),
    soId: uuid()
      .notNull()
      .references(() => salesOrders.id, { onDelete: "cascade" }),
    lineNo: smallint().notNull(),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    description: text(),
    quantity: numeric({ precision: 18, scale: 3 }).notNull(),
    unitPrice: numeric({ precision: 18, scale: 4 }).notNull(),
    amountForeign: numeric({ precision: 18, scale: 2 }).notNull(),
    baseAmount: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    quantityDelivered: numeric({ precision: 18, scale: 3 }).notNull().default("0"),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("sales_order_lines_so_line_uq").on(t.soId, t.lineNo),
    index("sales_order_lines_product_idx").on(t.productId),
    check("sales_order_lines_line_no_chk", sql`${t.lineNo} >= 1`),
    check("sales_order_lines_qty_chk", sql`${t.quantity} > 0`),
    check("sales_order_lines_price_chk", sql`${t.unitPrice} >= 0`),
    check("sales_order_lines_amount_chk", sql`${t.amountForeign} >= 0 and ${t.baseAmount} >= 0`),
    check("sales_order_lines_delivered_chk", sql`${t.quantityDelivered} >= 0`),
  ],
);

/* --------------------------- Delivery ----------------------------- */

/**
 * Pengiriman barang (DLV). Wajib merujuk SO. Saat posting:
 * 1. Issue stok via mesin FIFO (goods_issue dari warehouse).
 * 2. Posting jurnal: Dr COGS / Cr Inventory.
 * 3. Increment `quantityDelivered` pada baris SO.
 */
export const salesDeliveries = pgTable(
  "sales_deliveries",
  {
    id: primaryId(),
    docNo: text().unique(),
    status: salesDeliveryStatusEnum().notNull().default("draft"),
    soId: uuid()
      .notNull()
      .references(() => salesOrders.id),
    customerId: uuid()
      .notNull()
      .references(() => customers.id),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    warehouseId: uuid()
      .notNull()
      .references(() => warehouses.id),
    deliveryDate: date({ mode: "string" }).notNull(),
    notes: text(),
    journalEntryId: uuid().references(() => journalEntries.id),
    postedAt: timestamptz(),
    cancelledAt: timestamptz(),
    reversedAt: timestamptz(),
    reason: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("sales_deliveries_so_idx").on(t.soId),
    index("sales_deliveries_customer_idx").on(t.customerId),
    index("sales_deliveries_branch_date_idx").on(t.branchId, t.deliveryDate),
    index("sales_deliveries_status_idx").on(t.status, t.deliveryDate),
    check(
      "sales_deliveries_docno_chk",
      sql`(${t.status} in ('draft', 'cancelled') and ${t.docNo} is null) or (${t.status} in ('posted', 'reversed') and ${t.docNo} is not null)`,
    ),
    check(
      "sales_deliveries_posted_chk",
      sql`${t.status} <> 'posted' or ${t.journalEntryId} is not null`,
    ),
    check(
      "sales_deliveries_cancel_chk",
      sql`${t.status} <> 'cancelled' or (${t.cancelledAt} is not null and ${t.reason} is not null)`,
    ),
    check(
      "sales_deliveries_reverse_chk",
      sql`${t.status} <> 'reversed' or (${t.reversedAt} is not null and ${t.reason} is not null)`,
    ),
  ],
);

export const salesDeliveryLines = pgTable(
  "sales_delivery_lines",
  {
    id: primaryId(),
    deliveryId: uuid()
      .notNull()
      .references(() => salesDeliveries.id, { onDelete: "cascade" }),
    lineNo: smallint().notNull(),
    soLineId: uuid()
      .notNull()
      .references(() => salesOrderLines.id),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    description: text(),
    quantity: numeric({ precision: 18, scale: 3 }).notNull(),
    unitCost: numeric({ precision: 18, scale: 4 }),
    cogsAmount: numeric({ precision: 18, scale: 2 }),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("sales_delivery_lines_dlv_line_uq").on(t.deliveryId, t.lineNo),
    index("sales_delivery_lines_so_line_idx").on(t.soLineId),
    index("sales_delivery_lines_product_idx").on(t.productId),
    check("sales_delivery_lines_line_no_chk", sql`${t.lineNo} >= 1`),
    check("sales_delivery_lines_qty_chk", sql`${t.quantity} > 0`),
  ],
);

/* --------------------------- Sales Return -------------------------- */

/**
 * Retur penjualan (SRT). Merujuk delivery asli. Saat posting:
 * 1. Return stok via mesin FIFO (goods_receipt kembali ke warehouse).
 * 2. Posting jurnal: Dr Inventory / Cr COGS.
 */
export const salesReturns = pgTable(
  "sales_returns",
  {
    id: primaryId(),
    docNo: text().unique(),
    status: salesReturnStatusEnum().notNull().default("draft"),
    deliveryId: uuid()
      .notNull()
      .references(() => salesDeliveries.id),
    customerId: uuid()
      .notNull()
      .references(() => customers.id),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    warehouseId: uuid()
      .notNull()
      .references(() => warehouses.id),
    returnDate: date({ mode: "string" }).notNull(),
    notes: text(),
    journalEntryId: uuid().references(() => journalEntries.id),
    postedAt: timestamptz(),
    cancelledAt: timestamptz(),
    reversedAt: timestamptz(),
    reason: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("sales_returns_delivery_idx").on(t.deliveryId),
    index("sales_returns_customer_idx").on(t.customerId),
    index("sales_returns_branch_date_idx").on(t.branchId, t.returnDate),
    index("sales_returns_status_idx").on(t.status, t.returnDate),
    check(
      "sales_returns_docno_chk",
      sql`(${t.status} in ('draft', 'cancelled') and ${t.docNo} is null) or (${t.status} in ('posted', 'reversed') and ${t.docNo} is not null)`,
    ),
    check(
      "sales_returns_posted_chk",
      sql`${t.status} <> 'posted' or ${t.journalEntryId} is not null`,
    ),
    check(
      "sales_returns_cancel_chk",
      sql`${t.status} <> 'cancelled' or (${t.cancelledAt} is not null and ${t.reason} is not null)`,
    ),
    check(
      "sales_returns_reverse_chk",
      sql`${t.status} <> 'reversed' or (${t.reversedAt} is not null and ${t.reason} is not null)`,
    ),
  ],
);

export const salesReturnLines = pgTable(
  "sales_return_lines",
  {
    id: primaryId(),
    returnId: uuid()
      .notNull()
      .references(() => salesReturns.id, { onDelete: "cascade" }),
    lineNo: smallint().notNull(),
    deliveryLineId: uuid()
      .notNull()
      .references(() => salesDeliveryLines.id),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    description: text(),
    quantity: numeric({ precision: 18, scale: 3 }).notNull(),
    unitCost: numeric({ precision: 18, scale: 4 }),
    cogsAmount: numeric({ precision: 18, scale: 2 }),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("sales_return_lines_srt_line_uq").on(t.returnId, t.lineNo),
    index("sales_return_lines_delivery_line_idx").on(t.deliveryLineId),
    check("sales_return_lines_line_no_chk", sql`${t.lineNo} >= 1`),
    check("sales_return_lines_qty_chk", sql`${t.quantity} > 0`),
  ],
);

/* -------- Exported types -------- */

export type SalesQuotationStatus = (typeof salesQuotationStatusEnum.enumValues)[number];
export type SalesOrderStatus = (typeof salesOrderStatusEnum.enumValues)[number];
export type SalesDeliveryStatus = (typeof salesDeliveryStatusEnum.enumValues)[number];
export type SalesReturnStatus = (typeof salesReturnStatusEnum.enumValues)[number];
