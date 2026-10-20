CREATE TYPE "public"."purchase_order_status" AS ENUM('draft', 'pending_approval', 'approved', 'posted', 'cancelled');--> statement-breakpoint
CREATE TABLE "payment_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"due_in_days" smallint NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "payment_terms_code_chk" CHECK (length(trim("payment_terms"."code")) > 0),
	CONSTRAINT "payment_terms_name_chk" CHECK (length(trim("payment_terms"."name")) > 0),
	CONSTRAINT "payment_terms_due_chk" CHECK ("payment_terms"."due_in_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"product_id" uuid NOT NULL,
	"description" text,
	"quantity" numeric(18, 3) NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"amount_foreign" numeric(18, 2) NOT NULL,
	"base_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"quantity_received" numeric(18, 3) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "purchase_order_lines_line_no_chk" CHECK ("purchase_order_lines"."line_no" >= 1),
	CONSTRAINT "purchase_order_lines_qty_chk" CHECK ("purchase_order_lines"."quantity" > 0),
	CONSTRAINT "purchase_order_lines_price_chk" CHECK ("purchase_order_lines"."unit_price" >= 0),
	CONSTRAINT "purchase_order_lines_amount_chk" CHECK ("purchase_order_lines"."amount_foreign" >= 0 and "purchase_order_lines"."base_amount" >= 0),
	CONSTRAINT "purchase_order_lines_received_chk" CHECK ("purchase_order_lines"."quantity_received" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_no" text,
	"status" "purchase_order_status" DEFAULT 'draft' NOT NULL,
	"supplier_id" uuid NOT NULL,
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
	CONSTRAINT "purchase_orders_docNo_unique" UNIQUE("doc_no"),
	CONSTRAINT "purchase_orders_docno_chk" CHECK (("purchase_orders"."status" = 'posted' and "purchase_orders"."doc_no" is not null) or ("purchase_orders"."status" <> 'posted' and "purchase_orders"."doc_no" is null)),
	CONSTRAINT "purchase_orders_posted_rate_chk" CHECK ("purchase_orders"."status" <> 'posted' or ("purchase_orders"."exchange_rate" is not null and "purchase_orders"."exchange_rate" > 0)),
	CONSTRAINT "purchase_orders_currency_chk" CHECK ("purchase_orders"."currency" = upper("purchase_orders"."currency") and length("purchase_orders"."currency") = 3),
	CONSTRAINT "purchase_orders_cancel_chk" CHECK ("purchase_orders"."status" <> 'cancelled' or ("purchase_orders"."cancelled_at" is not null and "purchase_orders"."reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"tax_id" text,
	"currency" char(3) DEFAULT 'IDR' NOT NULL,
	"payment_terms_id" uuid,
	"email" text,
	"phone" text,
	"address" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "suppliers_code_chk" CHECK (length(trim("suppliers"."code")) > 0),
	CONSTRAINT "suppliers_name_chk" CHECK (length(trim("suppliers"."name")) > 0),
	CONSTRAINT "suppliers_currency_chk" CHECK ("suppliers"."currency" = upper("suppliers"."currency") and length("suppliers"."currency") = 3)
);
--> statement-breakpoint
ALTER TABLE "payment_terms" ADD CONSTRAINT "payment_terms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_terms" ADD CONSTRAINT "payment_terms_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_payment_terms_id_payment_terms_id_fk" FOREIGN KEY ("payment_terms_id") REFERENCES "public"."payment_terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_terms_code_uq" ON "payment_terms" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_lines_po_line_uq" ON "purchase_order_lines" USING btree ("po_id","line_no");--> statement-breakpoint
CREATE INDEX "purchase_order_lines_product_idx" ON "purchase_order_lines" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_idx" ON "purchase_orders" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_branch_date_idx" ON "purchase_orders" USING btree ("branch_id","order_date");--> statement-breakpoint
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders" USING btree ("status","order_date");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_code_uq" ON "suppliers" USING btree ("code");--> statement-breakpoint
CREATE INDEX "suppliers_payment_terms_idx" ON "suppliers" USING btree ("payment_terms_id");
--> statement-breakpoint
-- Guard 5F: master & PO. TRUNCATE massal diblokir agar identitas tak bisa dihapus diam-diam.
CREATE TRIGGER "payment_terms_truncate_guard"
  BEFORE TRUNCATE ON "payment_terms"
  FOR EACH STATEMENT EXECUTE FUNCTION erp_forbid_truncate();
--> statement-breakpoint
CREATE TRIGGER "suppliers_truncate_guard"
  BEFORE TRUNCATE ON "suppliers"
  FOR EACH STATEMENT EXECUTE FUNCTION erp_forbid_truncate();
--> statement-breakpoint
-- PO non-draf terkunci identitas komersialnya (supplier/cabang/tanggal/mata uang);
-- transisi status, doc_no, kurs, total_base, dan cap waktu tetap boleh ditulis mesin
-- (post mengisi rate/total_base/doc_no saat status masih approved -> posted).
CREATE OR REPLACE FUNCTION erp_purchase_orders_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'draft' AND (NEW.supplier_id, NEW.branch_id, NEW.order_date, NEW.expected_date, NEW.currency)
     IS DISTINCT FROM (OLD.supplier_id, OLD.branch_id, OLD.order_date, OLD.expected_date, OLD.currency) THEN
    RAISE EXCEPTION 'Purchase order non-draf tidak dapat mengubah identitas komersialnya';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "purchase_orders_immutable_guard" BEFORE UPDATE ON "purchase_orders" FOR EACH ROW EXECUTE FUNCTION erp_purchase_orders_immutable();
--> statement-breakpoint
CREATE TRIGGER "purchase_orders_truncate_guard"
  BEFORE TRUNCATE ON "purchase_orders"
  FOR EACH STATEMENT EXECUTE FUNCTION erp_forbid_truncate();
--> statement-breakpoint
-- Baris PO non-draf: komposisi (produk/qty/harga/nilai mata uang asing) terkunci.
-- base_amount (diisi saat post) dan quantity_received (dikurangi mesin GR) tetap boleh
-- berubah; koreksi komposisi dilakukan lewat pembatalan/PO baru, bukan edit baris.
CREATE OR REPLACE FUNCTION erp_purchase_order_lines_immutable() RETURNS trigger AS $$
BEGIN
  IF (SELECT status FROM "purchase_orders" WHERE "id" = COALESCE(NEW.po_id, OLD.po_id)) <> 'draft'
     AND (NEW.po_id, NEW.line_no, NEW.product_id, NEW.description, NEW.quantity, NEW.unit_price, NEW.amount_foreign)
         IS DISTINCT FROM (OLD.po_id, OLD.line_no, OLD.product_id, OLD.description, OLD.quantity, OLD.unit_price, OLD.amount_foreign) THEN
    RAISE EXCEPTION 'Baris purchase order non-draf tidak dapat diubah komposisinya; batalkan dan buat PO baru';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "purchase_order_lines_immutable_guard" BEFORE UPDATE OR DELETE ON "purchase_order_lines" FOR EACH ROW EXECUTE FUNCTION erp_purchase_order_lines_immutable();
--> statement-breakpoint
CREATE TRIGGER "purchase_order_lines_truncate_guard"
  BEFORE TRUNCATE ON "purchase_order_lines"
  FOR EACH STATEMENT EXECUTE FUNCTION erp_forbid_truncate();