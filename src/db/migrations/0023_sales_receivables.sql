CREATE TYPE "public"."sales_delivery_status" AS ENUM('draft', 'posted', 'cancelled', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."sales_order_status" AS ENUM('draft', 'pending_approval', 'approved', 'posted', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."sales_quotation_status" AS ENUM('draft', 'sent', 'accepted', 'rejected', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."sales_return_status" AS ENUM('draft', 'posted', 'cancelled', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."customer_invoice_status" AS ENUM('draft', 'posted', 'cancelled', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."customer_payment_status" AS ENUM('draft', 'posted', 'cancelled', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."sales_credit_note_status" AS ENUM('draft', 'posted', 'cancelled', 'reversed');--> statement-breakpoint
CREATE TABLE "sales_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_no" text,
	"status" "sales_delivery_status" DEFAULT 'draft' NOT NULL,
	"so_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"delivery_date" date NOT NULL,
	"notes" text,
	"journal_entry_id" uuid,
	"posted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "sales_deliveries_docNo_unique" UNIQUE("doc_no"),
	CONSTRAINT "sales_deliveries_docno_chk" CHECK (("sales_deliveries"."status" in ('draft', 'cancelled') and "sales_deliveries"."doc_no" is null) or ("sales_deliveries"."status" in ('posted', 'reversed') and "sales_deliveries"."doc_no" is not null)),
	CONSTRAINT "sales_deliveries_posted_chk" CHECK ("sales_deliveries"."status" <> 'posted' or "sales_deliveries"."journal_entry_id" is not null),
	CONSTRAINT "sales_deliveries_cancel_chk" CHECK ("sales_deliveries"."status" <> 'cancelled' or ("sales_deliveries"."cancelled_at" is not null and "sales_deliveries"."reason" is not null)),
	CONSTRAINT "sales_deliveries_reverse_chk" CHECK ("sales_deliveries"."status" <> 'reversed' or ("sales_deliveries"."reversed_at" is not null and "sales_deliveries"."reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "sales_delivery_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"so_line_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"description" text,
	"quantity" numeric(18, 3) NOT NULL,
	"unit_cost" numeric(18, 4),
	"cogs_amount" numeric(18, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "sales_delivery_lines_line_no_chk" CHECK ("sales_delivery_lines"."line_no" >= 1),
	CONSTRAINT "sales_delivery_lines_qty_chk" CHECK ("sales_delivery_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "sales_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"so_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"product_id" uuid NOT NULL,
	"description" text,
	"quantity" numeric(18, 3) NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"amount_foreign" numeric(18, 2) NOT NULL,
	"base_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"quantity_delivered" numeric(18, 3) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "sales_order_lines_line_no_chk" CHECK ("sales_order_lines"."line_no" >= 1),
	CONSTRAINT "sales_order_lines_qty_chk" CHECK ("sales_order_lines"."quantity" > 0),
	CONSTRAINT "sales_order_lines_price_chk" CHECK ("sales_order_lines"."unit_price" >= 0),
	CONSTRAINT "sales_order_lines_amount_chk" CHECK ("sales_order_lines"."amount_foreign" >= 0 and "sales_order_lines"."base_amount" >= 0),
	CONSTRAINT "sales_order_lines_delivered_chk" CHECK ("sales_order_lines"."quantity_delivered" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sales_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_no" text,
	"status" "sales_order_status" DEFAULT 'draft' NOT NULL,
	"quotation_id" uuid,
	"customer_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"order_date" date NOT NULL,
	"expected_date" date,
	"currency" char(3) NOT NULL,
	"exchange_rate" numeric(18, 6),
	"total_base" numeric(18, 2) DEFAULT '0' NOT NULL,
	"description" text,
	"notes" text,
	"approved_at" timestamp with time zone,
	"posted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "sales_orders_docNo_unique" UNIQUE("doc_no"),
	CONSTRAINT "sales_orders_docno_chk" CHECK (("sales_orders"."status" = 'posted' and "sales_orders"."doc_no" is not null) or ("sales_orders"."status" <> 'posted' and "sales_orders"."doc_no" is null)),
	CONSTRAINT "sales_orders_posted_rate_chk" CHECK ("sales_orders"."status" <> 'posted' or ("sales_orders"."exchange_rate" is not null and "sales_orders"."exchange_rate" > 0)),
	CONSTRAINT "sales_orders_currency_chk" CHECK ("sales_orders"."currency" = upper("sales_orders"."currency") and length("sales_orders"."currency") = 3),
	CONSTRAINT "sales_orders_cancel_chk" CHECK ("sales_orders"."status" <> 'cancelled' or ("sales_orders"."cancelled_at" is not null and "sales_orders"."reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "sales_quotation_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quotation_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"product_id" uuid NOT NULL,
	"description" text,
	"quantity" numeric(18, 3) NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"amount_foreign" numeric(18, 2) NOT NULL,
	"base_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "sales_quotation_lines_line_no_chk" CHECK ("sales_quotation_lines"."line_no" >= 1),
	CONSTRAINT "sales_quotation_lines_qty_chk" CHECK ("sales_quotation_lines"."quantity" > 0),
	CONSTRAINT "sales_quotation_lines_price_chk" CHECK ("sales_quotation_lines"."unit_price" >= 0),
	CONSTRAINT "sales_quotation_lines_amount_chk" CHECK ("sales_quotation_lines"."amount_foreign" >= 0 and "sales_quotation_lines"."base_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sales_quotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_no" text,
	"status" "sales_quotation_status" DEFAULT 'draft' NOT NULL,
	"customer_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"quotation_date" date NOT NULL,
	"valid_until" date,
	"currency" char(3) NOT NULL,
	"exchange_rate" numeric(18, 6),
	"total_base" numeric(18, 2) DEFAULT '0' NOT NULL,
	"description" text,
	"notes" text,
	"cancelled_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "sales_quotations_docNo_unique" UNIQUE("doc_no"),
	CONSTRAINT "sales_quotations_docno_chk" CHECK ("sales_quotations"."doc_no" is null),
	CONSTRAINT "sales_quotations_currency_chk" CHECK ("sales_quotations"."currency" = upper("sales_quotations"."currency") and length("sales_quotations"."currency") = 3),
	CONSTRAINT "sales_quotations_cancel_chk" CHECK ("sales_quotations"."status" <> 'cancelled' or ("sales_quotations"."cancelled_at" is not null and "sales_quotations"."reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "sales_return_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"delivery_line_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"description" text,
	"quantity" numeric(18, 3) NOT NULL,
	"unit_cost" numeric(18, 4),
	"cogs_amount" numeric(18, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "sales_return_lines_line_no_chk" CHECK ("sales_return_lines"."line_no" >= 1),
	CONSTRAINT "sales_return_lines_qty_chk" CHECK ("sales_return_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "sales_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_no" text,
	"status" "sales_return_status" DEFAULT 'draft' NOT NULL,
	"delivery_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"return_date" date NOT NULL,
	"notes" text,
	"journal_entry_id" uuid,
	"posted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "sales_returns_docNo_unique" UNIQUE("doc_no"),
	CONSTRAINT "sales_returns_docno_chk" CHECK (("sales_returns"."status" in ('draft', 'cancelled') and "sales_returns"."doc_no" is null) or ("sales_returns"."status" in ('posted', 'reversed') and "sales_returns"."doc_no" is not null)),
	CONSTRAINT "sales_returns_posted_chk" CHECK ("sales_returns"."status" <> 'posted' or "sales_returns"."journal_entry_id" is not null),
	CONSTRAINT "sales_returns_cancel_chk" CHECK ("sales_returns"."status" <> 'cancelled' or ("sales_returns"."cancelled_at" is not null and "sales_returns"."reason" is not null)),
	CONSTRAINT "sales_returns_reverse_chk" CHECK ("sales_returns"."status" <> 'reversed' or ("sales_returns"."reversed_at" is not null and "sales_returns"."reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "customer_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"delivery_line_id" uuid NOT NULL,
	"product_id" uuid,
	"description" text,
	"quantity" numeric(18, 3) NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"amount_foreign" numeric(18, 2) NOT NULL,
	"amount_base" numeric(18, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "customer_invoice_lines_line_no_chk" CHECK ("customer_invoice_lines"."line_no" >= 1),
	CONSTRAINT "customer_invoice_lines_qty_chk" CHECK ("customer_invoice_lines"."quantity" > 0),
	CONSTRAINT "customer_invoice_lines_price_chk" CHECK ("customer_invoice_lines"."unit_price" >= 0),
	CONSTRAINT "customer_invoice_lines_amount_chk" CHECK ("customer_invoice_lines"."amount_foreign" >= 0 and "customer_invoice_lines"."amount_base" >= 0)
);
--> statement-breakpoint
CREATE TABLE "customer_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_no" text,
	"status" "customer_invoice_status" DEFAULT 'draft' NOT NULL,
	"delivery_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"invoice_date" date NOT NULL,
	"due_date" date NOT NULL,
	"currency" char(3) NOT NULL,
	"exchange_rate" numeric(18, 6),
	"subtotal_foreign" numeric(18, 2) DEFAULT '0' NOT NULL,
	"tax_foreign" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_foreign" numeric(18, 2) DEFAULT '0' NOT NULL,
	"subtotal_base" numeric(18, 2) DEFAULT '0' NOT NULL,
	"tax_base" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_base" numeric(18, 2) DEFAULT '0' NOT NULL,
	"amount_paid" numeric(18, 2) DEFAULT '0' NOT NULL,
	"journal_entry_id" uuid,
	"tax_transaction_id" uuid,
	"notes" text,
	"posted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "customer_invoices_docNo_unique" UNIQUE("doc_no"),
	CONSTRAINT "customer_invoices_docno_chk" CHECK (("customer_invoices"."status" in ('draft', 'cancelled') and "customer_invoices"."doc_no" is null) or ("customer_invoices"."status" in ('posted', 'reversed') and "customer_invoices"."doc_no" is not null)),
	CONSTRAINT "customer_invoices_posted_chk" CHECK ("customer_invoices"."status" <> 'posted' or ("customer_invoices"."exchange_rate" is not null and "customer_invoices"."exchange_rate" > 0 and "customer_invoices"."total_base" > 0 and "customer_invoices"."journal_entry_id" is not null)),
	CONSTRAINT "customer_invoices_currency_chk" CHECK ("customer_invoices"."currency" = upper("customer_invoices"."currency") and length("customer_invoices"."currency") = 3),
	CONSTRAINT "customer_invoices_dates_chk" CHECK ("customer_invoices"."due_date" >= "customer_invoices"."invoice_date"),
	CONSTRAINT "customer_invoices_cancel_chk" CHECK ("customer_invoices"."status" <> 'cancelled' or ("customer_invoices"."cancelled_at" is not null and "customer_invoices"."reason" is not null)),
	CONSTRAINT "customer_invoices_reverse_chk" CHECK ("customer_invoices"."status" <> 'reversed' or ("customer_invoices"."reversed_at" is not null and "customer_invoices"."reason" is not null)),
	CONSTRAINT "customer_invoices_total_chk" CHECK ("customer_invoices"."total_foreign" = "customer_invoices"."subtotal_foreign" + "customer_invoices"."tax_foreign")
);
--> statement-breakpoint
CREATE TABLE "customer_payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_base" numeric(18, 2) NOT NULL,
	"amount_foreign" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "customer_payment_allocations_amount_chk" CHECK ("customer_payment_allocations"."amount_base" > 0)
);
--> statement-breakpoint
CREATE TABLE "customer_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_no" text,
	"status" "customer_payment_status" DEFAULT 'draft' NOT NULL,
	"customer_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"payment_date" date NOT NULL,
	"currency" char(3) NOT NULL,
	"exchange_rate" numeric(18, 6),
	"amount_foreign" numeric(18, 2) DEFAULT '0' NOT NULL,
	"amount_base" numeric(18, 2) DEFAULT '0' NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"journal_entry_id" uuid,
	"memo" text,
	"posted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "customer_payments_docNo_unique" UNIQUE("doc_no"),
	CONSTRAINT "customer_payments_docno_chk" CHECK (("customer_payments"."status" in ('draft', 'cancelled') and "customer_payments"."doc_no" is null) or ("customer_payments"."status" in ('posted', 'reversed') and "customer_payments"."doc_no" is not null)),
	CONSTRAINT "customer_payments_posted_chk" CHECK ("customer_payments"."status" <> 'posted' or ("customer_payments"."exchange_rate" is not null and "customer_payments"."exchange_rate" > 0 and "customer_payments"."amount_base" > 0 and "customer_payments"."journal_entry_id" is not null)),
	CONSTRAINT "customer_payments_currency_chk" CHECK ("customer_payments"."currency" = upper("customer_payments"."currency") and length("customer_payments"."currency") = 3),
	CONSTRAINT "customer_payments_amount_chk" CHECK ("customer_payments"."amount_foreign" >= 0 and "customer_payments"."amount_base" >= 0),
	CONSTRAINT "customer_payments_cancel_chk" CHECK ("customer_payments"."status" <> 'cancelled' or ("customer_payments"."cancelled_at" is not null and "customer_payments"."reason" is not null)),
	CONSTRAINT "customer_payments_reverse_chk" CHECK ("customer_payments"."status" <> 'reversed' or ("customer_payments"."reversed_at" is not null and "customer_payments"."reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "sales_credit_note_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_note_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"invoice_line_id" uuid,
	"product_id" uuid,
	"description" text,
	"quantity" numeric(18, 3) NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"amount_foreign" numeric(18, 2) NOT NULL,
	"amount_base" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "sales_credit_note_lines_line_no_chk" CHECK ("sales_credit_note_lines"."line_no" >= 1),
	CONSTRAINT "sales_credit_note_lines_qty_chk" CHECK ("sales_credit_note_lines"."quantity" > 0),
	CONSTRAINT "sales_credit_note_lines_price_chk" CHECK ("sales_credit_note_lines"."unit_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sales_credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_no" text,
	"status" "sales_credit_note_status" DEFAULT 'draft' NOT NULL,
	"invoice_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"credit_note_date" date NOT NULL,
	"currency" char(3) NOT NULL,
	"exchange_rate" numeric(18, 6),
	"total_foreign" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_base" numeric(18, 2) DEFAULT '0' NOT NULL,
	"journal_entry_id" uuid,
	"reason" text,
	"posted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "sales_credit_notes_docNo_unique" UNIQUE("doc_no"),
	CONSTRAINT "sales_credit_notes_docno_chk" CHECK (("sales_credit_notes"."status" in ('draft', 'cancelled') and "sales_credit_notes"."doc_no" is null) or ("sales_credit_notes"."status" in ('posted', 'reversed') and "sales_credit_notes"."doc_no" is not null)),
	CONSTRAINT "sales_credit_notes_posted_chk" CHECK ("sales_credit_notes"."status" <> 'posted' or ("sales_credit_notes"."journal_entry_id" is not null and "sales_credit_notes"."total_base" > 0)),
	CONSTRAINT "sales_credit_notes_currency_chk" CHECK ("sales_credit_notes"."currency" = upper("sales_credit_notes"."currency") and length("sales_credit_notes"."currency") = 3),
	CONSTRAINT "sales_credit_notes_cancel_chk" CHECK ("sales_credit_notes"."status" <> 'cancelled' or ("sales_credit_notes"."cancelled_at" is not null and "sales_credit_notes"."reason" is not null)),
	CONSTRAINT "sales_credit_notes_reverse_chk" CHECK ("sales_credit_notes"."status" <> 'reversed' or ("sales_credit_notes"."reversed_at" is not null and "sales_credit_notes"."reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "sales_deliveries" ADD CONSTRAINT "sales_deliveries_so_id_sales_orders_id_fk" FOREIGN KEY ("so_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_deliveries" ADD CONSTRAINT "sales_deliveries_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_deliveries" ADD CONSTRAINT "sales_deliveries_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_deliveries" ADD CONSTRAINT "sales_deliveries_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_deliveries" ADD CONSTRAINT "sales_deliveries_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_deliveries" ADD CONSTRAINT "sales_deliveries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_deliveries" ADD CONSTRAINT "sales_deliveries_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_delivery_lines" ADD CONSTRAINT "sales_delivery_lines_delivery_id_sales_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."sales_deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_delivery_lines" ADD CONSTRAINT "sales_delivery_lines_so_line_id_sales_order_lines_id_fk" FOREIGN KEY ("so_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_delivery_lines" ADD CONSTRAINT "sales_delivery_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_delivery_lines" ADD CONSTRAINT "sales_delivery_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_delivery_lines" ADD CONSTRAINT "sales_delivery_lines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_so_id_sales_orders_id_fk" FOREIGN KEY ("so_id") REFERENCES "public"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_quotation_id_sales_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."sales_quotations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotation_lines" ADD CONSTRAINT "sales_quotation_lines_quotation_id_sales_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."sales_quotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotation_lines" ADD CONSTRAINT "sales_quotation_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotation_lines" ADD CONSTRAINT "sales_quotation_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotation_lines" ADD CONSTRAINT "sales_quotation_lines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_lines" ADD CONSTRAINT "sales_return_lines_return_id_sales_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."sales_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_lines" ADD CONSTRAINT "sales_return_lines_delivery_line_id_sales_delivery_lines_id_fk" FOREIGN KEY ("delivery_line_id") REFERENCES "public"."sales_delivery_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_lines" ADD CONSTRAINT "sales_return_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_lines" ADD CONSTRAINT "sales_return_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_lines" ADD CONSTRAINT "sales_return_lines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_delivery_id_sales_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."sales_deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoice_lines" ADD CONSTRAINT "customer_invoice_lines_invoice_id_customer_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."customer_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoice_lines" ADD CONSTRAINT "customer_invoice_lines_delivery_line_id_sales_delivery_lines_id_fk" FOREIGN KEY ("delivery_line_id") REFERENCES "public"."sales_delivery_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoice_lines" ADD CONSTRAINT "customer_invoice_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoice_lines" ADD CONSTRAINT "customer_invoice_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoice_lines" ADD CONSTRAINT "customer_invoice_lines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_delivery_id_sales_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."sales_deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_tax_transaction_id_tax_transactions_id_fk" FOREIGN KEY ("tax_transaction_id") REFERENCES "public"."tax_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payment_allocations" ADD CONSTRAINT "customer_payment_allocations_payment_id_customer_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."customer_payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payment_allocations" ADD CONSTRAINT "customer_payment_allocations_invoice_id_customer_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."customer_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payment_allocations" ADD CONSTRAINT "customer_payment_allocations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payment_allocations" ADD CONSTRAINT "customer_payment_allocations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_credit_note_lines" ADD CONSTRAINT "sales_credit_note_lines_credit_note_id_sales_credit_notes_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "public"."sales_credit_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_credit_note_lines" ADD CONSTRAINT "sales_credit_note_lines_invoice_line_id_customer_invoice_lines_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."customer_invoice_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_credit_note_lines" ADD CONSTRAINT "sales_credit_note_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_credit_note_lines" ADD CONSTRAINT "sales_credit_note_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_credit_note_lines" ADD CONSTRAINT "sales_credit_note_lines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_credit_notes" ADD CONSTRAINT "sales_credit_notes_invoice_id_customer_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."customer_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_credit_notes" ADD CONSTRAINT "sales_credit_notes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_credit_notes" ADD CONSTRAINT "sales_credit_notes_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_credit_notes" ADD CONSTRAINT "sales_credit_notes_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_credit_notes" ADD CONSTRAINT "sales_credit_notes_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_credit_notes" ADD CONSTRAINT "sales_credit_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_credit_notes" ADD CONSTRAINT "sales_credit_notes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_deliveries_so_idx" ON "sales_deliveries" USING btree ("so_id");--> statement-breakpoint
CREATE INDEX "sales_deliveries_customer_idx" ON "sales_deliveries" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "sales_deliveries_branch_date_idx" ON "sales_deliveries" USING btree ("branch_id","delivery_date");--> statement-breakpoint
CREATE INDEX "sales_deliveries_status_idx" ON "sales_deliveries" USING btree ("status","delivery_date");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_delivery_lines_dlv_line_uq" ON "sales_delivery_lines" USING btree ("delivery_id","line_no");--> statement-breakpoint
CREATE INDEX "sales_delivery_lines_so_line_idx" ON "sales_delivery_lines" USING btree ("so_line_id");--> statement-breakpoint
CREATE INDEX "sales_delivery_lines_product_idx" ON "sales_delivery_lines" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_order_lines_so_line_uq" ON "sales_order_lines" USING btree ("so_id","line_no");--> statement-breakpoint
CREATE INDEX "sales_order_lines_product_idx" ON "sales_order_lines" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "sales_orders_customer_idx" ON "sales_orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "sales_orders_branch_date_idx" ON "sales_orders" USING btree ("branch_id","order_date");--> statement-breakpoint
CREATE INDEX "sales_orders_status_idx" ON "sales_orders" USING btree ("status","order_date");--> statement-breakpoint
CREATE INDEX "sales_orders_quotation_idx" ON "sales_orders" USING btree ("quotation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_quotation_lines_sq_line_uq" ON "sales_quotation_lines" USING btree ("quotation_id","line_no");--> statement-breakpoint
CREATE INDEX "sales_quotation_lines_product_idx" ON "sales_quotation_lines" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "sales_quotations_customer_idx" ON "sales_quotations" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "sales_quotations_branch_date_idx" ON "sales_quotations" USING btree ("branch_id","quotation_date");--> statement-breakpoint
CREATE INDEX "sales_quotations_status_idx" ON "sales_quotations" USING btree ("status","quotation_date");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_return_lines_srt_line_uq" ON "sales_return_lines" USING btree ("return_id","line_no");--> statement-breakpoint
CREATE INDEX "sales_return_lines_delivery_line_idx" ON "sales_return_lines" USING btree ("delivery_line_id");--> statement-breakpoint
CREATE INDEX "sales_returns_delivery_idx" ON "sales_returns" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "sales_returns_customer_idx" ON "sales_returns" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "sales_returns_branch_date_idx" ON "sales_returns" USING btree ("branch_id","return_date");--> statement-breakpoint
CREATE INDEX "sales_returns_status_idx" ON "sales_returns" USING btree ("status","return_date");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_invoice_lines_inv_line_uq" ON "customer_invoice_lines" USING btree ("invoice_id","line_no");--> statement-breakpoint
CREATE INDEX "customer_invoice_lines_delivery_line_idx" ON "customer_invoice_lines" USING btree ("delivery_line_id");--> statement-breakpoint
CREATE INDEX "customer_invoices_delivery_idx" ON "customer_invoices" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "customer_invoices_customer_idx" ON "customer_invoices" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_invoices_branch_date_idx" ON "customer_invoices" USING btree ("branch_id","invoice_date");--> statement-breakpoint
CREATE INDEX "customer_invoices_status_due_idx" ON "customer_invoices" USING btree ("status","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_payment_allocations_payment_invoice_uq" ON "customer_payment_allocations" USING btree ("payment_id","invoice_id");--> statement-breakpoint
CREATE INDEX "customer_payment_allocations_invoice_idx" ON "customer_payment_allocations" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "customer_payments_customer_idx" ON "customer_payments" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_payments_status_date_idx" ON "customer_payments" USING btree ("status","payment_date");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_credit_note_lines_cn_line_uq" ON "sales_credit_note_lines" USING btree ("credit_note_id","line_no");--> statement-breakpoint
CREATE INDEX "sales_credit_notes_invoice_idx" ON "sales_credit_notes" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "sales_credit_notes_customer_idx" ON "sales_credit_notes" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "sales_credit_notes_status_date_idx" ON "sales_credit_notes" USING btree ("status","credit_note_date");