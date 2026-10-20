CREATE TYPE "public"."asset_doc_status" AS ENUM('draft', 'posted', 'reversed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."asset_funding_source" AS ENUM('bank', 'cash', 'payable');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('draft', 'active', 'idle', 'in_service', 'disposed');--> statement-breakpoint
CREATE TYPE "public"."depreciation_method" AS ENUM('straight_line', 'declining_balance', 'units_of_production');--> statement-breakpoint
CREATE TYPE "public"."depreciation_run_status" AS ENUM('draft', 'calculated', 'approved', 'posted', 'cancelled', 'reversed');--> statement-breakpoint
CREATE TABLE "asset_acquisitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_no" text,
	"asset_id" uuid NOT NULL,
	"acquisition_date" date NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"funding_source" "asset_funding_source" NOT NULL,
	"bank_account_id" uuid,
	"journal_entry_id" uuid,
	"status" "asset_doc_status" DEFAULT 'draft' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "asset_acquisitions_docNo_unique" UNIQUE("doc_no"),
	CONSTRAINT "asset_acquisitions_amount_chk" CHECK ("asset_acquisitions"."amount" > 0),
	CONSTRAINT "asset_acquisitions_docno_chk" CHECK (("asset_acquisitions"."status" in ('draft', 'cancelled') and "asset_acquisitions"."doc_no" is null) or ("asset_acquisitions"."status" in ('posted', 'reversed') and "asset_acquisitions"."doc_no" is not null)),
	CONSTRAINT "asset_acquisitions_funding_chk" CHECK ("asset_acquisitions"."funding_source" = 'payable' OR "asset_acquisitions"."bank_account_id" is not null),
	CONSTRAINT "asset_acquisitions_cancel_chk" CHECK ("asset_acquisitions"."status" <> 'cancelled' or "asset_acquisitions"."cancelled_at" is not null),
	CONSTRAINT "asset_acquisitions_reverse_chk" CHECK ("asset_acquisitions"."status" <> 'reversed' or ("asset_acquisitions"."reversed_at" is not null and "asset_acquisitions"."reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "asset_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"depreciation_method" "depreciation_method" DEFAULT 'straight_line' NOT NULL,
	"useful_life_months" integer DEFAULT 48 NOT NULL,
	"residual_percent" numeric(9, 4) DEFAULT '0' NOT NULL,
	"declining_rate_percent" numeric(9, 4),
	"total_units" integer,
	"asset_cost_account_id" uuid,
	"accumulated_depreciation_account_id" uuid,
	"depreciation_expense_account_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "asset_categories_code_chk" CHECK (length(trim("asset_categories"."code")) > 0),
	CONSTRAINT "asset_categories_name_chk" CHECK (length(trim("asset_categories"."name")) > 0),
	CONSTRAINT "asset_categories_life_chk" CHECK ("asset_categories"."useful_life_months" >= 1),
	CONSTRAINT "asset_categories_residual_chk" CHECK ("asset_categories"."residual_percent" >= 0 and "asset_categories"."residual_percent" < 100),
	CONSTRAINT "asset_categories_db_rate_chk" CHECK ("asset_categories"."declining_rate_percent" IS NULL OR ("asset_categories"."declining_rate_percent" > 0 and "asset_categories"."declining_rate_percent" <= 100)),
	CONSTRAINT "asset_categories_units_chk" CHECK ("asset_categories"."total_units" IS NULL OR "asset_categories"."total_units" > 0)
);
--> statement-breakpoint
CREATE TABLE "asset_depreciation_run_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"opening_book_value" numeric(18, 2) NOT NULL,
	"depreciation_amount" numeric(18, 2) NOT NULL,
	"accumulated_after" numeric(18, 2) NOT NULL,
	"closing_book_value" numeric(18, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "asset_depr_run_items_period_chk" CHECK (length(trim("asset_depreciation_run_items"."period_key")) > 0),
	CONSTRAINT "asset_depr_run_items_amount_chk" CHECK ("asset_depreciation_run_items"."opening_book_value" >= 0 and "asset_depreciation_run_items"."depreciation_amount" >= 0 and "asset_depreciation_run_items"."closing_book_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "asset_depreciation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_no" text,
	"period_id" uuid NOT NULL,
	"branch_id" uuid,
	"status" "depreciation_run_status" DEFAULT 'draft' NOT NULL,
	"asset_count" integer DEFAULT 0 NOT NULL,
	"total_depreciation" numeric(18, 2) DEFAULT '0' NOT NULL,
	"journal_entry_id" uuid,
	"calculated_by" uuid,
	"approved_by" uuid,
	"posted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "asset_depreciation_runs_docNo_unique" UNIQUE("doc_no"),
	CONSTRAINT "asset_depr_runs_docno_chk" CHECK (("asset_depreciation_runs"."status" in ('draft', 'calculated', 'approved', 'cancelled') and "asset_depreciation_runs"."doc_no" is null) or ("asset_depreciation_runs"."status" in ('posted', 'reversed') and "asset_depreciation_runs"."doc_no" is not null)),
	CONSTRAINT "asset_depr_runs_posted_chk" CHECK ("asset_depreciation_runs"."status" <> 'posted' or ("asset_depreciation_runs"."asset_count" > 0 and "asset_depreciation_runs"."total_depreciation" > 0 and "asset_depreciation_runs"."journal_entry_id" is not null)),
	CONSTRAINT "asset_depr_runs_totals_chk" CHECK ("asset_depreciation_runs"."total_depreciation" >= 0 and "asset_depreciation_runs"."asset_count" >= 0),
	CONSTRAINT "asset_depr_runs_cancel_chk" CHECK ("asset_depreciation_runs"."status" <> 'cancelled' or ("asset_depreciation_runs"."cancelled_at" is not null and "asset_depreciation_runs"."reason" is not null)),
	CONSTRAINT "asset_depr_runs_reverse_chk" CHECK ("asset_depreciation_runs"."status" <> 'reversed' or ("asset_depreciation_runs"."reversed_at" is not null and "asset_depreciation_runs"."reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "asset_depreciation_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"seq_no" integer NOT NULL,
	"opening_book_value" numeric(18, 2) NOT NULL,
	"depreciation_amount" numeric(18, 2) NOT NULL,
	"accumulated_after" numeric(18, 2) NOT NULL,
	"closing_book_value" numeric(18, 2) NOT NULL,
	"is_booked" boolean DEFAULT false NOT NULL,
	"run_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "asset_depr_schedules_period_chk" CHECK (length(trim("asset_depreciation_schedules"."period_key")) > 0),
	CONSTRAINT "asset_depr_schedules_seq_chk" CHECK ("asset_depreciation_schedules"."seq_no" >= 1),
	CONSTRAINT "asset_depr_schedules_amount_chk" CHECK ("asset_depreciation_schedules"."depreciation_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "asset_disposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_no" text,
	"asset_id" uuid NOT NULL,
	"disposal_date" date NOT NULL,
	"proceeds_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"cost_removed" numeric(18, 2) NOT NULL,
	"accumulated_removed" numeric(18, 2) NOT NULL,
	"gain_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"loss_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"bank_account_id" uuid,
	"journal_entry_id" uuid,
	"status" "asset_doc_status" DEFAULT 'draft' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "asset_disposals_docNo_unique" UNIQUE("doc_no"),
	CONSTRAINT "asset_disposals_proceeds_chk" CHECK ("asset_disposals"."proceeds_amount" >= 0),
	CONSTRAINT "asset_disposals_cost_chk" CHECK ("asset_disposals"."cost_removed" >= 0),
	CONSTRAINT "asset_disposals_accum_chk" CHECK ("asset_disposals"."accumulated_removed" >= 0),
	CONSTRAINT "asset_disposals_gainloss_chk" CHECK ("asset_disposals"."gain_amount" >= 0 and "asset_disposals"."loss_amount" >= 0),
	CONSTRAINT "asset_disposals_docno_chk" CHECK (("asset_disposals"."status" in ('draft', 'cancelled') and "asset_disposals"."doc_no" is null) or ("asset_disposals"."status" in ('posted', 'reversed') and "asset_disposals"."doc_no" is not null)),
	CONSTRAINT "asset_disposals_cancel_chk" CHECK ("asset_disposals"."status" <> 'cancelled' or "asset_disposals"."cancelled_at" is not null),
	CONSTRAINT "asset_disposals_reverse_chk" CHECK ("asset_disposals"."status" <> 'reversed' or ("asset_disposals"."reversed_at" is not null and "asset_disposals"."reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "asset_maintenance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"maintenance_date" date NOT NULL,
	"description" text NOT NULL,
	"vendor" text,
	"cost" numeric(18, 2),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "asset_maintenance_desc_chk" CHECK (length(trim("asset_maintenance"."description")) > 0),
	CONSTRAINT "asset_maintenance_cost_chk" CHECK ("asset_maintenance"."cost" IS NULL OR "asset_maintenance"."cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "asset_revaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_no" text,
	"asset_id" uuid NOT NULL,
	"effective_date" date NOT NULL,
	"new_cost" numeric(18, 2) NOT NULL,
	"new_accumulated" numeric(18, 2) NOT NULL,
	"journal_entry_id" uuid,
	"status" "asset_doc_status" DEFAULT 'draft' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "asset_revaluations_docNo_unique" UNIQUE("doc_no"),
	CONSTRAINT "asset_revaluations_cost_chk" CHECK ("asset_revaluations"."new_cost" > 0),
	CONSTRAINT "asset_revaluations_accum_chk" CHECK ("asset_revaluations"."new_accumulated" >= 0 and "asset_revaluations"."new_accumulated" <= "asset_revaluations"."new_cost"),
	CONSTRAINT "asset_revaluations_docno_chk" CHECK (("asset_revaluations"."status" in ('draft', 'cancelled') and "asset_revaluations"."doc_no" is null) or ("asset_revaluations"."status" in ('posted', 'reversed') and "asset_revaluations"."doc_no" is not null))
);
--> statement-breakpoint
CREATE TABLE "asset_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"transfer_date" date NOT NULL,
	"from_branch_id" uuid,
	"to_branch_id" uuid,
	"from_department_id" uuid,
	"to_department_id" uuid,
	"to_cost_center_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "asset_transfers_diff_chk" CHECK ("asset_transfers"."to_branch_id" IS NULL OR "asset_transfers"."to_branch_id" <> "asset_transfers"."from_branch_id" OR "asset_transfers"."to_department_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "asset_usage_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"units" integer NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "asset_usage_entries_period_chk" CHECK (length(trim("asset_usage_entries"."period_key")) > 0),
	CONSTRAINT "asset_usage_entries_units_chk" CHECK ("asset_usage_entries"."units" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fixed_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid NOT NULL,
	"branch_id" uuid,
	"department_id" uuid,
	"cost_center_id" uuid,
	"location" text,
	"in_service_date" date NOT NULL,
	"cost" numeric(18, 2) NOT NULL,
	"accumulated_depreciation" numeric(18, 2) DEFAULT '0' NOT NULL,
	"residual_value" numeric(18, 2),
	"useful_life_months" integer,
	"depreciation_method" "depreciation_method",
	"declining_rate_percent" numeric(9, 4),
	"total_units" integer,
	"units_period" integer,
	"status" "asset_status" DEFAULT 'draft' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "fixed_assets_code_chk" CHECK (length(trim("fixed_assets"."code")) > 0),
	CONSTRAINT "fixed_assets_name_chk" CHECK (length(trim("fixed_assets"."name")) > 0),
	CONSTRAINT "fixed_assets_cost_chk" CHECK ("fixed_assets"."cost" > 0),
	CONSTRAINT "fixed_assets_accum_chk" CHECK ("fixed_assets"."accumulated_depreciation" >= 0),
	CONSTRAINT "fixed_assets_accum_le_cost_chk" CHECK ("fixed_assets"."accumulated_depreciation" <= "fixed_assets"."cost"),
	CONSTRAINT "fixed_assets_residual_chk" CHECK ("fixed_assets"."residual_value" IS NULL OR "fixed_assets"."residual_value" >= 0),
	CONSTRAINT "fixed_assets_life_chk" CHECK ("fixed_assets"."useful_life_months" IS NULL OR "fixed_assets"."useful_life_months" >= 1),
	CONSTRAINT "fixed_assets_db_rate_chk" CHECK ("fixed_assets"."declining_rate_percent" IS NULL OR ("fixed_assets"."declining_rate_percent" > 0 and "fixed_assets"."declining_rate_percent" <= 100)),
	CONSTRAINT "fixed_assets_units_chk" CHECK ("fixed_assets"."total_units" IS NULL OR "fixed_assets"."total_units" > 0),
	CONSTRAINT "fixed_assets_unitsperiod_chk" CHECK ("fixed_assets"."units_period" IS NULL OR "fixed_assets"."units_period" > 0)
);
--> statement-breakpoint
ALTER TABLE "asset_acquisitions" ADD CONSTRAINT "asset_acquisitions_asset_id_fixed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_acquisitions" ADD CONSTRAINT "asset_acquisitions_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_acquisitions" ADD CONSTRAINT "asset_acquisitions_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_acquisitions" ADD CONSTRAINT "asset_acquisitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_acquisitions" ADD CONSTRAINT "asset_acquisitions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_asset_cost_account_id_chart_accounts_id_fk" FOREIGN KEY ("asset_cost_account_id") REFERENCES "public"."chart_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_accumulated_depreciation_account_id_chart_accounts_id_fk" FOREIGN KEY ("accumulated_depreciation_account_id") REFERENCES "public"."chart_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_depreciation_expense_account_id_chart_accounts_id_fk" FOREIGN KEY ("depreciation_expense_account_id") REFERENCES "public"."chart_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation_run_items" ADD CONSTRAINT "asset_depreciation_run_items_run_id_asset_depreciation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."asset_depreciation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation_run_items" ADD CONSTRAINT "asset_depreciation_run_items_asset_id_fixed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation_run_items" ADD CONSTRAINT "asset_depreciation_run_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation_run_items" ADD CONSTRAINT "asset_depreciation_run_items_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation_runs" ADD CONSTRAINT "asset_depreciation_runs_period_id_accounting_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."accounting_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation_runs" ADD CONSTRAINT "asset_depreciation_runs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation_runs" ADD CONSTRAINT "asset_depreciation_runs_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation_runs" ADD CONSTRAINT "asset_depreciation_runs_calculated_by_users_id_fk" FOREIGN KEY ("calculated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation_runs" ADD CONSTRAINT "asset_depreciation_runs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation_runs" ADD CONSTRAINT "asset_depreciation_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation_runs" ADD CONSTRAINT "asset_depreciation_runs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation_schedules" ADD CONSTRAINT "asset_depreciation_schedules_asset_id_fixed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation_schedules" ADD CONSTRAINT "asset_depreciation_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation_schedules" ADD CONSTRAINT "asset_depreciation_schedules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_disposals" ADD CONSTRAINT "asset_disposals_asset_id_fixed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_disposals" ADD CONSTRAINT "asset_disposals_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_disposals" ADD CONSTRAINT "asset_disposals_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_disposals" ADD CONSTRAINT "asset_disposals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_disposals" ADD CONSTRAINT "asset_disposals_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_maintenance" ADD CONSTRAINT "asset_maintenance_asset_id_fixed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_maintenance" ADD CONSTRAINT "asset_maintenance_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_maintenance" ADD CONSTRAINT "asset_maintenance_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_revaluations" ADD CONSTRAINT "asset_revaluations_asset_id_fixed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_revaluations" ADD CONSTRAINT "asset_revaluations_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_revaluations" ADD CONSTRAINT "asset_revaluations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_revaluations" ADD CONSTRAINT "asset_revaluations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transfers" ADD CONSTRAINT "asset_transfers_asset_id_fixed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transfers" ADD CONSTRAINT "asset_transfers_from_branch_id_branches_id_fk" FOREIGN KEY ("from_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transfers" ADD CONSTRAINT "asset_transfers_to_branch_id_branches_id_fk" FOREIGN KEY ("to_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transfers" ADD CONSTRAINT "asset_transfers_from_department_id_departments_id_fk" FOREIGN KEY ("from_department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transfers" ADD CONSTRAINT "asset_transfers_to_department_id_departments_id_fk" FOREIGN KEY ("to_department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transfers" ADD CONSTRAINT "asset_transfers_to_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("to_cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transfers" ADD CONSTRAINT "asset_transfers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transfers" ADD CONSTRAINT "asset_transfers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_usage_entries" ADD CONSTRAINT "asset_usage_entries_asset_id_fixed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_usage_entries" ADD CONSTRAINT "asset_usage_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_usage_entries" ADD CONSTRAINT "asset_usage_entries_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_category_id_asset_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."asset_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_acquisitions_asset_idx" ON "asset_acquisitions" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_acquisitions_status_idx" ON "asset_acquisitions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_categories_code_uq" ON "asset_categories" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_depr_run_items_run_asset_uq" ON "asset_depreciation_run_items" USING btree ("run_id","asset_id");--> statement-breakpoint
CREATE INDEX "asset_depr_run_items_asset_idx" ON "asset_depreciation_run_items" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_depr_runs_period_idx" ON "asset_depreciation_runs" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "asset_depr_runs_status_idx" ON "asset_depreciation_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_depr_schedules_asset_period_uq" ON "asset_depreciation_schedules" USING btree ("asset_id","period_key");--> statement-breakpoint
CREATE INDEX "asset_depr_schedules_period_idx" ON "asset_depreciation_schedules" USING btree ("period_key");--> statement-breakpoint
CREATE INDEX "asset_disposals_asset_idx" ON "asset_disposals" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_disposals_status_idx" ON "asset_disposals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "asset_maintenance_asset_idx" ON "asset_maintenance" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_revaluations_asset_idx" ON "asset_revaluations" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_transfers_asset_idx" ON "asset_transfers" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_usage_entries_asset_period_uq" ON "asset_usage_entries" USING btree ("asset_id","period_key");--> statement-breakpoint
CREATE UNIQUE INDEX "fixed_assets_code_uq" ON "fixed_assets" USING btree ("code");--> statement-breakpoint
CREATE INDEX "fixed_assets_category_idx" ON "fixed_assets" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "fixed_assets_branch_idx" ON "fixed_assets" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "fixed_assets_status_idx" ON "fixed_assets" USING btree ("status");