CREATE TYPE "public"."stock_movement_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."stock_source_type" AS ENUM('opening', 'goods_receipt', 'goods_issue', 'transfer', 'adjustment');--> statement-breakpoint
CREATE TABLE "stock_cost_layers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"receipt_movement_id" uuid NOT NULL,
	"movement_date" date NOT NULL,
	"quantity_received" numeric(18, 3) NOT NULL,
	"quantity_remaining" numeric(18, 3) NOT NULL,
	"unit_cost" numeric(18, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "stock_cost_layers_recv_chk" CHECK ("stock_cost_layers"."quantity_received" > 0),
	CONSTRAINT "stock_cost_layers_remaining_chk" CHECK ("stock_cost_layers"."quantity_remaining" >= 0 and "stock_cost_layers"."quantity_remaining" <= "stock_cost_layers"."quantity_received"),
	CONSTRAINT "stock_cost_layers_cost_chk" CHECK ("stock_cost_layers"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_layer_consumptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_movement_id" uuid NOT NULL,
	"layer_id" uuid NOT NULL,
	"quantity" numeric(18, 3) NOT NULL,
	"unit_cost" numeric(18, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "stock_layer_consumptions_qty_chk" CHECK ("stock_layer_consumptions"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"movement_date" date NOT NULL,
	"product_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"location_id" uuid,
	"direction" "stock_movement_direction" NOT NULL,
	"quantity" numeric(18, 3) NOT NULL,
	"unit_cost" numeric(18, 4),
	"total_cost" numeric(18, 2),
	"source_type" "stock_source_type" NOT NULL,
	"source_id" uuid,
	"source_doc_no" text,
	"reverse_of_id" uuid,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "stock_movements_qty_chk" CHECK ("stock_movements"."quantity" > 0),
	CONSTRAINT "stock_movements_in_cost_chk" CHECK ("stock_movements"."direction" <> 'in' or "stock_movements"."unit_cost" is not null),
	CONSTRAINT "stock_movements_unit_cost_chk" CHECK ("stock_movements"."unit_cost" is null or "stock_movements"."unit_cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "stock_cost_layers" ADD CONSTRAINT "stock_cost_layers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_cost_layers" ADD CONSTRAINT "stock_cost_layers_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_cost_layers" ADD CONSTRAINT "stock_cost_layers_receipt_movement_id_stock_movements_id_fk" FOREIGN KEY ("receipt_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_cost_layers" ADD CONSTRAINT "stock_cost_layers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_cost_layers" ADD CONSTRAINT "stock_cost_layers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_layer_consumptions" ADD CONSTRAINT "stock_layer_consumptions_issue_movement_id_stock_movements_id_fk" FOREIGN KEY ("issue_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_layer_consumptions" ADD CONSTRAINT "stock_layer_consumptions_layer_id_stock_cost_layers_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."stock_cost_layers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_layer_consumptions" ADD CONSTRAINT "stock_layer_consumptions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_layer_consumptions" ADD CONSTRAINT "stock_layer_consumptions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_location_id_warehouse_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."warehouse_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_reverse_of_id_stock_movements_id_fk" FOREIGN KEY ("reverse_of_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_cost_layers_fifo_idx" ON "stock_cost_layers" USING btree ("product_id","warehouse_id","movement_date","id");--> statement-breakpoint
CREATE INDEX "stock_layer_consumptions_issue_idx" ON "stock_layer_consumptions" USING btree ("issue_movement_id");--> statement-breakpoint
CREATE INDEX "stock_layer_consumptions_layer_idx" ON "stock_layer_consumptions" USING btree ("layer_id");--> statement-breakpoint
CREATE INDEX "stock_movements_product_warehouse_date_idx" ON "stock_movements" USING btree ("product_id","warehouse_id","movement_date");--> statement-breakpoint
CREATE INDEX "stock_movements_reverse_of_idx" ON "stock_movements" USING btree ("reverse_of_id") WHERE "stock_movements"."reverse_of_id" is not null;
--> statement-breakpoint
-- Custom SQL: ledger stok bersifat append-only. Baris pergerakan & jejak konsumsi
-- tidak dapat diubah/dihapus; koreksi dilakukan lewat reversal (menyusul). Hanya
-- kolom quantity_remaining pada lapisan biaya yang boleh berubah (konsumsi FIFO).
CREATE OR REPLACE FUNCTION erp_stock_movements_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Baris stock ledger bersifat append-only dan tidak dapat diubah/dihapus; gunakan pergerakan penyeimbang';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "stock_movements_immutable_guard"
  BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION erp_stock_movements_immutable();
--> statement-breakpoint
CREATE TRIGGER "stock_layer_consumptions_immutable_guard"
  BEFORE UPDATE OR DELETE ON "stock_layer_consumptions"
  FOR EACH ROW EXECUTE FUNCTION erp_stock_movements_immutable();
--> statement-breakpoint
CREATE TRIGGER "stock_movements_truncate_guard"
  BEFORE TRUNCATE ON "stock_movements"
  FOR EACH STATEMENT EXECUTE FUNCTION erp_forbid_truncate();
--> statement-breakpoint
CREATE TRIGGER "stock_layer_consumptions_truncate_guard"
  BEFORE TRUNCATE ON "stock_layer_consumptions"
  FOR EACH STATEMENT EXECUTE FUNCTION erp_forbid_truncate();