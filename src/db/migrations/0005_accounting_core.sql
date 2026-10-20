CREATE TYPE "public"."account_type" AS ENUM('asset', 'liability', 'equity', 'revenue', 'expense');--> statement-breakpoint
CREATE TYPE "public"."journal_status" AS ENUM('draft', 'posted', 'reversed', 'cancelled');--> statement-breakpoint
CREATE TABLE "chart_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "account_type" NOT NULL,
	"parent_id" uuid,
	"is_postable" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "chart_accounts_code_unique" UNIQUE("code"),
	CONSTRAINT "chart_accounts_code_format_chk" CHECK ("chart_accounts"."code" ~ '^[A-Za-z0-9][A-Za-z0-9.-]*$'),
	CONSTRAINT "chart_accounts_parent_chk" CHECK ("chart_accounts"."parent_id" is null or "chart_accounts"."parent_id" <> "chart_accounts"."id")
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_no" text,
	"entry_date" date NOT NULL,
	"period_id" uuid,
	"status" "journal_status" DEFAULT 'draft' NOT NULL,
	"description" text NOT NULL,
	"reference" text,
	"source_type" text,
	"source_id" uuid,
	"source_event" text,
	"reversal_of_id" uuid,
	"total_debit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_credit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"posted_at" timestamp with time zone,
	"posted_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"reason" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "journal_entries_docNo_unique" UNIQUE("doc_no"),
	CONSTRAINT "journal_entries_idempotencyKey_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "journal_entries_draft_no_number_chk" CHECK ("journal_entries"."status" <> 'draft' or "journal_entries"."doc_no" is null),
	CONSTRAINT "journal_entries_posted_fields_chk" CHECK ("journal_entries"."status" in ('draft', 'cancelled') or ("journal_entries"."doc_no" is not null and "journal_entries"."period_id" is not null and "journal_entries"."posted_at" is not null and "journal_entries"."posted_by" is not null)),
	CONSTRAINT "journal_entries_balanced_chk" CHECK ("journal_entries"."status" in ('draft', 'cancelled') or ("journal_entries"."total_debit" = "journal_entries"."total_credit" and "journal_entries"."total_debit" > 0)),
	CONSTRAINT "journal_entries_totals_nonneg_chk" CHECK ("journal_entries"."total_debit" >= 0 and "journal_entries"."total_credit" >= 0),
	CONSTRAINT "journal_entries_source_all_or_none_chk" CHECK (("journal_entries"."source_type" is null) = ("journal_entries"."source_id" is null) and ("journal_entries"."source_type" is null) = ("journal_entries"."source_event" is null)),
	CONSTRAINT "journal_entries_reversal_self_chk" CHECK ("journal_entries"."reversal_of_id" is null or "journal_entries"."reversal_of_id" <> "journal_entries"."id"),
	CONSTRAINT "journal_entries_cancel_fields_chk" CHECK ("journal_entries"."status" <> 'cancelled' or ("journal_entries"."cancelled_at" is not null and "journal_entries"."reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "journal_entry_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"account_id" uuid NOT NULL,
	"debit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"memo" text,
	"branch_id" uuid,
	"department_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entry_lines_line_no_chk" CHECK ("journal_entry_lines"."line_no" >= 1),
	CONSTRAINT "journal_entry_lines_amounts_chk" CHECK ("journal_entry_lines"."debit" >= 0 and "journal_entry_lines"."credit" >= 0 and ("journal_entry_lines"."debit" = 0 or "journal_entry_lines"."credit" = 0) and ("journal_entry_lines"."debit" + "journal_entry_lines"."credit") > 0)
);
--> statement-breakpoint
ALTER TABLE "chart_accounts" ADD CONSTRAINT "chart_accounts_parent_id_chart_accounts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."chart_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_accounts" ADD CONSTRAINT "chart_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_accounts" ADD CONSTRAINT "chart_accounts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_period_id_accounting_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."accounting_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversal_of_id_journal_entries_id_fk" FOREIGN KEY ("reversal_of_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_account_id_chart_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."chart_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chart_accounts_parent_idx" ON "chart_accounts" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_source_active_uq" ON "journal_entries" USING btree ("source_type","source_id","source_event") WHERE "journal_entries"."source_type" is not null and "journal_entries"."status" in ('draft', 'posted');--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_reversal_uq" ON "journal_entries" USING btree ("reversal_of_id") WHERE "journal_entries"."reversal_of_id" is not null and "journal_entries"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "journal_entries_ledger_date_idx" ON "journal_entries" USING btree ("entry_date","id") WHERE "journal_entries"."status" in ('posted', 'reversed');--> statement-breakpoint
CREATE INDEX "journal_entries_ledger_period_idx" ON "journal_entries" USING btree ("period_id") WHERE "journal_entries"."status" in ('posted', 'reversed');--> statement-breakpoint
CREATE INDEX "journal_entries_status_date_idx" ON "journal_entries" USING btree ("status","entry_date");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entry_lines_entry_line_uq" ON "journal_entry_lines" USING btree ("entry_id","line_no");--> statement-breakpoint
CREATE INDEX "journal_entry_lines_account_idx" ON "journal_entry_lines" USING btree ("account_id","entry_id");--> statement-breakpoint
CREATE INDEX "journal_entry_lines_branch_idx" ON "journal_entry_lines" USING btree ("branch_id") WHERE "journal_entry_lines"."branch_id" is not null;--> statement-breakpoint
CREATE INDEX "journal_entry_lines_department_idx" ON "journal_entry_lines" USING btree ("department_id") WHERE "journal_entry_lines"."department_id" is not null;