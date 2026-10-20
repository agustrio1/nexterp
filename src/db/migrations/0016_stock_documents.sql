CREATE TYPE "public"."stock_document_status" AS ENUM('draft', 'posted', 'reversed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."stock_document_type" AS ENUM('receipt', 'issue', 'transfer', 'adjustment', 'opname');--> statement-breakpoint
CREATE TABLE "stock_document_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"from_location_id" uuid,
	"to_location_id" uuid,
	"direction" "stock_movement_direction",
	"quantity" numeric(18, 3) NOT NULL,
	"unit_cost" numeric(18, 4),
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "stock_document_lines_qty_chk" CHECK ("stock_document_lines"."quantity" >= 0),
	CONSTRAINT "stock_document_lines_cost_chk" CHECK ("stock_document_lines"."unit_cost" is null or "stock_document_lines"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_no" text,
	"type" "stock_document_type" NOT NULL,
	"status" "stock_document_status" DEFAULT 'draft' NOT NULL,
	"document_date" date NOT NULL,
	"branch_id" uuid NOT NULL,
	"from_warehouse_id" uuid,
	"to_warehouse_id" uuid,
	"description" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "stock_documents_docNo_unique" UNIQUE("doc_no"),
	CONSTRAINT "stock_documents_posted_docno_chk" CHECK ("stock_documents"."status" <> 'posted' or "stock_documents"."doc_no" is not null),
	CONSTRAINT "stock_documents_warehouse_chk" CHECK (("stock_documents"."type" = 'receipt' and "stock_documents"."to_warehouse_id" is not null and "stock_documents"."from_warehouse_id" is null)
        or ("stock_documents"."type" = 'issue' and "stock_documents"."from_warehouse_id" is not null and "stock_documents"."to_warehouse_id" is null)
        or ("stock_documents"."type" = 'transfer' and "stock_documents"."from_warehouse_id" is not null and "stock_documents"."to_warehouse_id" is not null and "stock_documents"."from_warehouse_id" <> "stock_documents"."to_warehouse_id")
        or ("stock_documents"."type" in ('adjustment', 'opname') and "stock_documents"."from_warehouse_id" is not null and "stock_documents"."to_warehouse_id" is null))
);
--> statement-breakpoint
ALTER TABLE "stock_document_lines" ADD CONSTRAINT "stock_document_lines_document_id_stock_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."stock_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_document_lines" ADD CONSTRAINT "stock_document_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_document_lines" ADD CONSTRAINT "stock_document_lines_from_location_id_warehouse_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."warehouse_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_document_lines" ADD CONSTRAINT "stock_document_lines_to_location_id_warehouse_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."warehouse_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_document_lines" ADD CONSTRAINT "stock_document_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_document_lines" ADD CONSTRAINT "stock_document_lines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_from_warehouse_id_warehouses_id_fk" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_to_warehouse_id_warehouses_id_fk" FOREIGN KEY ("to_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_document_lines_document_idx" ON "stock_document_lines" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "stock_document_lines_product_idx" ON "stock_document_lines" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "stock_documents_branch_idx" ON "stock_documents" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "stock_documents_type_date_idx" ON "stock_documents" USING btree ("type","document_date");
--> statement-breakpoint
-- Guard 5D: dokumen yang telah keluar dari draft tidak boleh diedit isinya/identitasnya.
-- Status boleh bertransisi (draft->posted->reversed) dan doc_no diisi saat posting, tetapi
-- jenis/cabang/tanggal/gudang dan barisnya terkunci pasca-draf; koreksi lewat reversal.
CREATE OR REPLACE FUNCTION erp_stock_documents_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'draft' AND (NEW.type, NEW.branch_id, NEW.document_date, NEW.from_warehouse_id, NEW.to_warehouse_id, NEW.doc_no)
     IS DISTINCT FROM (OLD.type, OLD.branch_id, OLD.document_date, OLD.from_warehouse_id, OLD.to_warehouse_id, OLD.doc_no) THEN
    RAISE EXCEPTION 'Dokumen stok non-draf tidak dapat diubah identitas/isinya; gunakan reversal';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "stock_documents_immutable_guard" BEFORE UPDATE ON "stock_documents" FOR EACH ROW EXECUTE FUNCTION erp_stock_documents_immutable();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION erp_stock_document_lines_immutable() RETURNS trigger AS $$
BEGIN
  IF (SELECT status FROM "stock_documents" WHERE "id" = COALESCE(NEW.document_id, OLD.document_id)) <> 'draft' THEN
    RAISE EXCEPTION 'Baris dokumen stok non-draf tidak dapat diubah/dihapus; gunakan reversal';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "stock_document_lines_immutable_guard" BEFORE UPDATE OR DELETE ON "stock_document_lines" FOR EACH ROW EXECUTE FUNCTION erp_stock_document_lines_immutable();
--> statement-breakpoint
CREATE TRIGGER "stock_documents_truncate_guard" BEFORE TRUNCATE ON "stock_documents" FOR EACH STATEMENT EXECUTE FUNCTION erp_forbid_truncate();
--> statement-breakpoint
CREATE TRIGGER "stock_document_lines_truncate_guard" BEFORE TRUNCATE ON "stock_document_lines" FOR EACH STATEMENT EXECUTE FUNCTION erp_forbid_truncate();