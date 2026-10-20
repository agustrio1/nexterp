import { sql } from "drizzle-orm";
import {
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
import { branches, currencies } from "./organization";
import { products } from "./inventory";

/* ------------------------------------------------------------------ */
/* Tahap 5F: master procurement (termin pembayaran, supplier)         */
/* ------------------------------------------------------------------ */
// Master data pembelian. Supplier & termin pembayaran adalah master sederhana:
// tidak pernah dihapus, hanya dinonaktifkan. Nilai uang/qty selalu string desimal
// lewat src/lib/money.ts; kolom numeric hanya menyimpan hasil final.

/** Termin pembayaran (mis. NET30). `dueInDays` menentukan jatuh tempo tagihan 5G. */
export const paymentTerms = pgTable(
  "payment_terms",
  {
    id: primaryId(),
    code: text().notNull(),
    name: text().notNull(),
    dueInDays: smallint().notNull(),
    description: text(),
    isActive: boolean().notNull().default(true),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("payment_terms_code_uq").on(t.code),
    check("payment_terms_code_chk", sql`length(trim(${t.code})) > 0`),
    check("payment_terms_name_chk", sql`length(trim(${t.name})) > 0`),
    check("payment_terms_due_chk", sql`${t.dueInDays} > 0`),
  ],
);

/**
 * Master pemasok. `currency` menentukan mata uang penawaran baku (IDR bila tidak
 * multi-currency); `paymentTermsId` opsional sebagai termin bawaan supplier.
 */
export const suppliers = pgTable(
  "suppliers",
  {
    id: primaryId(),
    code: text().notNull(),
    name: text().notNull(),
    taxId: text(),
    currency: char({ length: 3 })
      .notNull()
      .default("IDR")
      .references(() => currencies.code),
    paymentTermsId: uuid().references(() => paymentTerms.id),
    email: text(),
    phone: text(),
    address: text(),
    notes: text(),
    isActive: boolean().notNull().default(true),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("suppliers_code_uq").on(t.code),
    index("suppliers_payment_terms_idx").on(t.paymentTermsId),
    check("suppliers_code_chk", sql`length(trim(${t.code})) > 0`),
    check("suppliers_name_chk", sql`length(trim(${t.name})) > 0`),
    check("suppliers_currency_chk", sql`${t.currency} = upper(${t.currency}) and length(${t.currency}) = 3`),
  ],
);

/* ------------------------------------------------------------------ */
/* Tahap 5F: Purchase Order (header + baris, state machine)           */
/* ------------------------------------------------------------------ */
// Siklus hidup (keputusan 5F): draft -> pending_approval (submit ke mesin 3J)
// -> approved (saat approval_request berstatus approved) -> posted (PO dibuka
// untuk penerimaan/GR) -> cancelled. Hanya draft yang dapat diedit. `docNo`
// baru terbit saat posting; kurs & baseAmount di-snapshot saat posting.
// PO tidak menyentuh buku besar (jurnal GR/IR terjadi di 5G).

export const purchaseOrderStatusEnum = pgEnum("purchase_order_status", [
  "draft",
  "pending_approval",
  "approved",
  "posted",
  "cancelled",
]);

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: primaryId(),
    docNo: text().unique(),
    status: purchaseOrderStatusEnum().notNull().default("draft"),
    supplierId: uuid()
      .notNull()
      .references(() => suppliers.id),
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
    index("purchase_orders_supplier_idx").on(t.supplierId),
    index("purchase_orders_branch_date_idx").on(t.branchId, t.orderDate),
    index("purchase_orders_status_idx").on(t.status, t.orderDate),
    check(
      "purchase_orders_docno_chk",
      sql`(${t.status} = 'posted' and ${t.docNo} is not null) or (${t.status} <> 'posted' and ${t.docNo} is null)`,
    ),
    check(
      "purchase_orders_posted_rate_chk",
      sql`${t.status} <> 'posted' or (${t.exchangeRate} is not null and ${t.exchangeRate} > 0)`,
    ),
    check(
      "purchase_orders_currency_chk",
      sql`${t.currency} = upper(${t.currency}) and length(${t.currency}) = 3`,
    ),
    check(
      "purchase_orders_cancel_chk",
      sql`${t.status} <> 'cancelled' or (${t.cancelledAt} is not null and ${t.reason} is not null)`,
    ),
  ],
);

/**
 * Baris PO. `quantity` = qty pesan; `quantityReceived` dikelola mesin GR-dari-PO
 * (tidak pernah diubah langsung). `unitPrice`/`amountForeign` dalam mata uang PO;
 * `baseAmount` hasil konversi kurs yang di-snapshot saat posting.
 */
export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: primaryId(),
    poId: uuid()
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    lineNo: smallint().notNull(),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    description: text(),
    quantity: numeric({ precision: 18, scale: 3 }).notNull(),
    unitPrice: numeric({ precision: 18, scale: 4 }).notNull(),
    amountForeign: numeric({ precision: 18, scale: 2 }).notNull(),
    baseAmount: numeric({ precision: 18, scale: 2 }).notNull().default("0"),
    quantityReceived: numeric({ precision: 18, scale: 3 }).notNull().default("0"),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("purchase_order_lines_po_line_uq").on(t.poId, t.lineNo),
    index("purchase_order_lines_product_idx").on(t.productId),
    check("purchase_order_lines_line_no_chk", sql`${t.lineNo} >= 1`),
    check("purchase_order_lines_qty_chk", sql`${t.quantity} > 0`),
    check("purchase_order_lines_price_chk", sql`${t.unitPrice} >= 0`),
    check("purchase_order_lines_amount_chk", sql`${t.amountForeign} >= 0 and ${t.baseAmount} >= 0`),
    check("purchase_order_lines_received_chk", sql`${t.quantityReceived} >= 0`),
  ],
);

export type PurchaseOrderStatus = (typeof purchaseOrderStatusEnum.enumValues)[number];
