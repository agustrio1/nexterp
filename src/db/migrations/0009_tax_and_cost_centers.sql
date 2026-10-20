CREATE TYPE "public"."tax_kind" AS ENUM('output', 'input', 'withholding');--> statement-breakpoint
CREATE TYPE "public"."tax_transaction_direction" AS ENUM('collect', 'pay');--> statement-breakpoint
CREATE TABLE "cost_centers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"branch_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "cost_centers_code_unique" UNIQUE("code"),
	CONSTRAINT "cost_centers_code_chk" CHECK (length(trim("cost_centers"."code")) > 0),
	CONSTRAINT "cost_centers_parent_chk" CHECK ("cost_centers"."parent_id" is null or "cost_centers"."parent_id" <> "cost_centers"."id")
);
--> statement-breakpoint
CREATE TABLE "tax_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tax_id" uuid NOT NULL,
	"rate" numeric(9, 4) NOT NULL,
	"effective_from" date NOT NULL,
	"source" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "tax_rates_rate_chk" CHECK ("tax_rates"."rate" >= 0),
	CONSTRAINT "tax_rates_source_chk" CHECK (length(trim("tax_rates"."source")) > 0)
);
--> statement-breakpoint
CREATE TABLE "tax_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_no" text NOT NULL,
	"tax_id" uuid NOT NULL,
	"transaction_date" date NOT NULL,
	"period_id" uuid,
	"direction" "tax_transaction_direction" NOT NULL,
	"base_amount" numeric(18, 2) NOT NULL,
	"rate" numeric(9, 4) NOT NULL,
	"tax_amount" numeric(18, 2) NOT NULL,
	"branch_id" uuid,
	"cost_center_id" uuid,
	"journal_entry_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "tax_transactions_docNo_unique" UNIQUE("doc_no"),
	CONSTRAINT "tax_transactions_base_chk" CHECK ("tax_transactions"."base_amount" >= 0),
	CONSTRAINT "tax_transactions_amount_chk" CHECK ("tax_transactions"."tax_amount" >= 0),
	CONSTRAINT "tax_transactions_rate_chk" CHECK ("tax_transactions"."rate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "taxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" "tax_kind" NOT NULL,
	"tax_account_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "taxes_code_unique" UNIQUE("code"),
	CONSTRAINT "taxes_code_chk" CHECK (length(trim("taxes"."code")) > 0)
);
--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD COLUMN "cost_center_id" uuid;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_parent_id_cost_centers_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_tax_id_taxes_id_fk" FOREIGN KEY ("tax_id") REFERENCES "public"."taxes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_transactions" ADD CONSTRAINT "tax_transactions_tax_id_taxes_id_fk" FOREIGN KEY ("tax_id") REFERENCES "public"."taxes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_transactions" ADD CONSTRAINT "tax_transactions_period_id_accounting_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."accounting_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_transactions" ADD CONSTRAINT "tax_transactions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_transactions" ADD CONSTRAINT "tax_transactions_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_transactions" ADD CONSTRAINT "tax_transactions_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_transactions" ADD CONSTRAINT "tax_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_transactions" ADD CONSTRAINT "tax_transactions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxes" ADD CONSTRAINT "taxes_tax_account_id_chart_accounts_id_fk" FOREIGN KEY ("tax_account_id") REFERENCES "public"."chart_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxes" ADD CONSTRAINT "taxes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxes" ADD CONSTRAINT "taxes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cost_centers_parent_idx" ON "cost_centers" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "cost_centers_branch_idx" ON "cost_centers" USING btree ("branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_rates_tax_effective_uq" ON "tax_rates" USING btree ("tax_id","effective_from");--> statement-breakpoint
CREATE INDEX "tax_rates_tax_date_idx" ON "tax_rates" USING btree ("tax_id","effective_from");--> statement-breakpoint
CREATE INDEX "tax_transactions_tax_idx" ON "tax_transactions" USING btree ("tax_id","transaction_date");--> statement-breakpoint
CREATE INDEX "tax_transactions_period_idx" ON "tax_transactions" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "taxes_account_idx" ON "taxes" USING btree ("tax_account_id");--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_entry_lines_cost_center_idx" ON "journal_entry_lines" USING btree ("cost_center_id") WHERE "journal_entry_lines"."cost_center_id" is not null;