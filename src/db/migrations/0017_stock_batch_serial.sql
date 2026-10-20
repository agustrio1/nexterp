CREATE TYPE "public"."product_tracking" AS ENUM('none', 'batch', 'serial', 'both');--> statement-breakpoint
CREATE TYPE "public"."serial_status" AS ENUM('in_stock', 'issued', 'returned');--> statement-breakpoint
CREATE TABLE "stock_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"batch_no" text NOT NULL,
	"expiry_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "stock_batches_batch_no_chk" CHECK (length(trim("stock_batches"."batch_no")) > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_serials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"batch_id" uuid,
	"serial_no" text NOT NULL,
	"status" serial_status DEFAULT 'in_stock' NOT NULL,
	"warehouse_id" uuid,
	"movement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "stock_serials_serial_no_chk" CHECK (length(trim("stock_serials"."serial_no")) > 0)
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "tracking" "product_tracking" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "needs_expiry" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_cost_layers" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_cost_layers" ADD COLUMN "expiry_date" date;--> statement-breakpoint
ALTER TABLE "stock_document_lines" ADD COLUMN "batch_no" text;--> statement-breakpoint
ALTER TABLE "stock_document_lines" ADD COLUMN "batch_expiry_date" date;--> statement-breakpoint
ALTER TABLE "stock_document_lines" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_document_lines" ADD COLUMN "serial_numbers" jsonb;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_serials" ADD CONSTRAINT "stock_serials_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_serials" ADD CONSTRAINT "stock_serials_batch_id_stock_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."stock_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_serials" ADD CONSTRAINT "stock_serials_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_serials" ADD CONSTRAINT "stock_serials_movement_id_stock_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_serials" ADD CONSTRAINT "stock_serials_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_serials" ADD CONSTRAINT "stock_serials_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_batches_product_batch_no_uq" ON "stock_batches" USING btree ("product_id","batch_no");--> statement-breakpoint
CREATE INDEX "stock_batches_expiry_idx" ON "stock_batches" USING btree ("expiry_date");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_serials_serial_no_uq" ON "stock_serials" USING btree ("serial_no");--> statement-breakpoint
CREATE INDEX "stock_serials_product_status_idx" ON "stock_serials" USING btree ("product_id","status");--> statement-breakpoint
ALTER TABLE "stock_cost_layers" ADD CONSTRAINT "stock_cost_layers_batch_id_stock_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."stock_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_document_lines" ADD CONSTRAINT "stock_document_lines_batch_id_stock_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."stock_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_batch_id_stock_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."stock_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_cost_layers_fefo_idx" ON "stock_cost_layers" USING btree ("product_id","warehouse_id","expiry_date","movement_date","id");
--> statement-breakpoint
-- Guard 5E-batch: batch & serial adalah tabel status yang barisnya diubah mesin
-- (expiry backfill, status serial in_stock/issued/returned), jadi TIDAK dibuat
-- immutable. Hanya TRUNCATE massal yang diblokir agar identitas unit/batch tak
-- bisa dihapus diam-diam; koreksi tetap lewat pergerakan/ledger.
CREATE TRIGGER "stock_batches_truncate_guard"
  BEFORE TRUNCATE ON "stock_batches"
  FOR EACH STATEMENT EXECUTE FUNCTION erp_forbid_truncate();
--> statement-breakpoint
CREATE TRIGGER "stock_serials_truncate_guard"
  BEFORE TRUNCATE ON "stock_serials"
  FOR EACH STATEMENT EXECUTE FUNCTION erp_forbid_truncate();