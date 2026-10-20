CREATE TYPE "public"."ap_payment_status" AS ENUM('draft', 'posted', 'cancelled', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."supplier_invoice_status" AS ENUM('draft', 'posted', 'cancelled', 'reversed');--> statement-breakpoint
CREATE TABLE "ap_payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_base" numeric(18, 2) NOT NULL,
	"amount_foreign" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "ap_payment_allocations_amount_chk" CHECK ("ap_payment_allocations"."amount_base" > 0)
);
--> statement-breakpoint
CREATE TABLE "ap_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_no" text,
	"status" "ap_payment_status" DEFAULT 'draft' NOT NULL,
	"supplier_id" uuid NOT NULL,
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
	CONSTRAINT "ap_payments_docNo_unique" UNIQUE("doc_no"),
	CONSTRAINT "ap_payments_docno_chk" CHECK (("ap_payments"."status" = 'posted' and "ap_payments"."doc_no" is not null) or ("ap_payments"."status" <> 'posted' and "ap_payments"."doc_no" is null)),
	CONSTRAINT "ap_payments_posted_chk" CHECK ("ap_payments"."status" <> 'posted' or ("ap_payments"."exchange_rate" is not null and "ap_payments"."exchange_rate" > 0 and "ap_payments"."amount_base" > 0 and "ap_payments"."journal_entry_id" is not null)),
	CONSTRAINT "ap_payments_currency_chk" CHECK ("ap_payments"."currency" = upper("ap_payments"."currency") and length("ap_payments"."currency") = 3),
	CONSTRAINT "ap_payments_amount_chk" CHECK ("ap_payments"."amount_foreign" >= 0 and "ap_payments"."amount_base" >= 0),
	CONSTRAINT "ap_payments_cancel_chk" CHECK ("ap_payments"."status" <> 'cancelled' or ("ap_payments"."cancelled_at" is not null and "ap_payments"."reason" is not null)),
	CONSTRAINT "ap_payments_reverse_chk" CHECK ("ap_payments"."status" <> 'reversed' or ("ap_payments"."reversed_at" is not null and "ap_payments"."reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "supplier_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"po_line_id" uuid NOT NULL,
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
	CONSTRAINT "supplier_invoice_lines_line_no_chk" CHECK ("supplier_invoice_lines"."line_no" >= 1),
	CONSTRAINT "supplier_invoice_lines_qty_chk" CHECK ("supplier_invoice_lines"."quantity" > 0),
	CONSTRAINT "supplier_invoice_lines_price_chk" CHECK ("supplier_invoice_lines"."unit_price" >= 0),
	CONSTRAINT "supplier_invoice_lines_amount_chk" CHECK ("supplier_invoice_lines"."amount_foreign" >= 0 and "supplier_invoice_lines"."amount_base" >= 0)
);
--> statement-breakpoint
CREATE TABLE "supplier_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_no" text,
	"status" "supplier_invoice_status" DEFAULT 'draft' NOT NULL,
	"supplier_id" uuid NOT NULL,
	"po_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"invoice_date" date NOT NULL,
	"due_date" date NOT NULL,
	"currency" char(3) NOT NULL,
	"exchange_rate" numeric(18, 6),
	"total_foreign" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_base" numeric(18, 2) DEFAULT '0' NOT NULL,
	"journal_entry_id" uuid,
	"notes" text,
	"posted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "supplier_invoices_docNo_unique" UNIQUE("doc_no"),
	CONSTRAINT "supplier_invoices_docno_chk" CHECK (("supplier_invoices"."status" = 'posted' and "supplier_invoices"."doc_no" is not null) or ("supplier_invoices"."status" <> 'posted' and "supplier_invoices"."doc_no" is null)),
	CONSTRAINT "supplier_invoices_posted_chk" CHECK ("supplier_invoices"."status" <> 'posted' or ("supplier_invoices"."exchange_rate" is not null and "supplier_invoices"."exchange_rate" > 0 and "supplier_invoices"."total_base" > 0 and "supplier_invoices"."journal_entry_id" is not null)),
	CONSTRAINT "supplier_invoices_currency_chk" CHECK ("supplier_invoices"."currency" = upper("supplier_invoices"."currency") and length("supplier_invoices"."currency") = 3),
	CONSTRAINT "supplier_invoices_dates_chk" CHECK ("supplier_invoices"."due_date" >= "supplier_invoices"."invoice_date"),
	CONSTRAINT "supplier_invoices_cancel_chk" CHECK ("supplier_invoices"."status" <> 'cancelled' or ("supplier_invoices"."cancelled_at" is not null and "supplier_invoices"."reason" is not null)),
	CONSTRAINT "supplier_invoices_reverse_chk" CHECK ("supplier_invoices"."status" <> 'reversed' or ("supplier_invoices"."reversed_at" is not null and "supplier_invoices"."reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD COLUMN "currency" char(3);--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD COLUMN "exchange_rate" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD COLUMN "amount_foreign" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "ap_payment_allocations" ADD CONSTRAINT "ap_payment_allocations_payment_id_ap_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."ap_payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_payment_allocations" ADD CONSTRAINT "ap_payment_allocations_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_payment_allocations" ADD CONSTRAINT "ap_payment_allocations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_payment_allocations" ADD CONSTRAINT "ap_payment_allocations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_payments" ADD CONSTRAINT "ap_payments_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_payments" ADD CONSTRAINT "ap_payments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_payments" ADD CONSTRAINT "ap_payments_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_payments" ADD CONSTRAINT "ap_payments_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_payments" ADD CONSTRAINT "ap_payments_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_payments" ADD CONSTRAINT "ap_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_payments" ADD CONSTRAINT "ap_payments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_po_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("po_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ap_payment_allocations_payment_invoice_uq" ON "ap_payment_allocations" USING btree ("payment_id","invoice_id");--> statement-breakpoint
CREATE INDEX "ap_payment_allocations_invoice_idx" ON "ap_payment_allocations" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "ap_payments_supplier_idx" ON "ap_payments" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "ap_payments_status_date_idx" ON "ap_payments" USING btree ("status","payment_date");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_invoice_lines_invoice_line_uq" ON "supplier_invoice_lines" USING btree ("invoice_id","line_no");--> statement-breakpoint
CREATE INDEX "supplier_invoice_lines_po_line_idx" ON "supplier_invoice_lines" USING btree ("po_line_id");--> statement-breakpoint
CREATE INDEX "supplier_invoices_supplier_idx" ON "supplier_invoices" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "supplier_invoices_po_idx" ON "supplier_invoices" USING btree ("po_id");--> statement-breakpoint
CREATE INDEX "supplier_invoices_status_due_idx" ON "supplier_invoices" USING btree ("status","due_date");--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Guard 5G: AP + GR/IR. TRUNCATE massal diblokir agar subledger utang tak bisa dihapus diam-diam.
CREATE TRIGGER "supplier_invoices_truncate_guard"
  BEFORE TRUNCATE ON "supplier_invoices"
  FOR EACH STATEMENT EXECUTE FUNCTION erp_forbid_truncate();
--> statement-breakpoint
CREATE TRIGGER "supplier_invoice_lines_truncate_guard"
  BEFORE TRUNCATE ON "supplier_invoice_lines"
  FOR EACH STATEMENT EXECUTE FUNCTION erp_forbid_truncate();
--> statement-breakpoint
CREATE TRIGGER "ap_payments_truncate_guard"
  BEFORE TRUNCATE ON "ap_payments"
  FOR EACH STATEMENT EXECUTE FUNCTION erp_forbid_truncate();
--> statement-breakpoint
CREATE TRIGGER "ap_payment_allocations_truncate_guard"
  BEFORE TRUNCATE ON "ap_payment_allocations"
  FOR EACH STATEMENT EXECUTE FUNCTION erp_forbid_truncate();
--> statement-breakpoint
-- Invoice non-draf terkunci identitas komersialnya (pemasok/PO/cabang/tanggal/mata uang);
-- transisi status, doc_no, kurs, total_base, journal_entry_id, dan cap waktu tetap boleh
-- ditulis mesin (post mengisi rate/total_base/doc_no/journal saat draft -> posted).
CREATE OR REPLACE FUNCTION erp_supplier_invoices_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'draft' AND (NEW.supplier_id, NEW.po_id, NEW.branch_id, NEW.invoice_date, NEW.due_date, NEW.currency)
     IS DISTINCT FROM (OLD.supplier_id, OLD.po_id, OLD.branch_id, OLD.invoice_date, OLD.due_date, OLD.currency) THEN
    RAISE EXCEPTION 'Invoice pemasok non-draf tidak dapat mengubah identitas komersialnya; lakukan reversal dan buat invoice baru';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "supplier_invoices_immutable_guard" BEFORE UPDATE ON "supplier_invoices" FOR EACH ROW EXECUTE FUNCTION erp_supplier_invoices_immutable();
--> statement-breakpoint
-- Baris invoice non-draf: komposisi (baris PO/produk/qty/harga/nilai asing) terkunci.
-- amount_base (diisi saat post) tetap boleh berubah; koreksi komposisi lewat reversal.
CREATE OR REPLACE FUNCTION erp_supplier_invoice_lines_immutable() RETURNS trigger AS $$
BEGIN
  IF (SELECT status FROM "supplier_invoices" WHERE "id" = COALESCE(NEW.invoice_id, OLD.invoice_id)) <> 'draft'
     AND (NEW.invoice_id, NEW.line_no, NEW.po_line_id, NEW.product_id, NEW.description, NEW.quantity, NEW.unit_price, NEW.amount_foreign)
         IS DISTINCT FROM (OLD.invoice_id, OLD.line_no, OLD.po_line_id, OLD.product_id, OLD.description, OLD.quantity, OLD.unit_price, OLD.amount_foreign) THEN
    RAISE EXCEPTION 'Baris invoice non-draf tidak dapat diubah komposisinya; lakukan reversal dan buat invoice baru';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "supplier_invoice_lines_immutable_guard" BEFORE UPDATE OR DELETE ON "supplier_invoice_lines" FOR EACH ROW EXECUTE FUNCTION erp_supplier_invoice_lines_immutable();
--> statement-breakpoint
-- Pembayaran non-draf terkunci identitas + nominal asingnya; post mengisi kurs/amount_base/
-- doc_no/journal_entry_id, dan reversal menghapus alokasi (bukan mengubah kolom terkunci ini).
CREATE OR REPLACE FUNCTION erp_ap_payments_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'draft' AND (NEW.supplier_id, NEW.branch_id, NEW.payment_date, NEW.currency, NEW.bank_account_id, NEW.amount_foreign)
     IS DISTINCT FROM (OLD.supplier_id, OLD.branch_id, OLD.payment_date, OLD.currency, OLD.bank_account_id, OLD.amount_foreign) THEN
    RAISE EXCEPTION 'Pembayaran AP non-draf tidak dapat diubah identitas/nominalnya; lakukan reversal dan buat pembayaran baru';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "ap_payments_immutable_guard" BEFORE UPDATE ON "ap_payments" FOR EACH ROW EXECUTE FUNCTION erp_ap_payments_immutable();
--> statement-breakpoint
-- Alokasi pembayaran dibuat saat post dan dihapus saat reversal; tak ada jalur edit manual.
CREATE OR REPLACE FUNCTION erp_ap_payment_allocations_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Alokasi pembayaran AP tidak dapat diubah langsung; lakukan reversal pembayaran';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "ap_payment_allocations_immutable_guard" BEFORE UPDATE ON "ap_payment_allocations" FOR EACH ROW EXECUTE FUNCTION erp_ap_payment_allocations_immutable();