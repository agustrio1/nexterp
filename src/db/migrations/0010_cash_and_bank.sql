CREATE TYPE "public"."bank_account_kind" AS ENUM('cash', 'bank');--> statement-breakpoint
CREATE TYPE "public"."cash_transaction_status" AS ENUM('draft', 'posted', 'reversed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."cash_transaction_type" AS ENUM('receipt', 'disbursement', 'transfer');--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" "bank_account_kind" NOT NULL,
	"bank_name" text,
	"account_number" text,
	"branch_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "bank_accounts_code_unique" UNIQUE("code"),
	CONSTRAINT "bank_accounts_code_chk" CHECK (length(trim("bank_accounts"."code")) > 0)
);
--> statement-breakpoint
CREATE TABLE "cash_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_no" text,
	"transaction_date" date NOT NULL,
	"type" "cash_transaction_type" NOT NULL,
	"status" "cash_transaction_status" DEFAULT 'draft' NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"contra_account_id" uuid,
	"counterpart_bank_account_id" uuid,
	"amount" numeric(18, 2) NOT NULL,
	"branch_id" uuid,
	"cost_center_id" uuid,
	"journal_entry_id" uuid,
	"description" text NOT NULL,
	"reference" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "cash_transactions_docNo_unique" UNIQUE("doc_no"),
	CONSTRAINT "cash_transactions_amount_chk" CHECK ("cash_transactions"."amount" > 0),
	CONSTRAINT "cash_transactions_party_chk" CHECK (("cash_transactions"."type" = 'transfer' AND "cash_transactions"."counterpart_bank_account_id" is not null AND "cash_transactions"."contra_account_id" is null)
        OR ("cash_transactions"."type" in ('receipt', 'disbursement') AND "cash_transactions"."contra_account_id" is not null AND "cash_transactions"."counterpart_bank_account_id" is null)),
	CONSTRAINT "cash_transactions_self_transfer_chk" CHECK ("cash_transactions"."counterpart_bank_account_id" is null or "cash_transactions"."counterpart_bank_account_id" <> "cash_transactions"."bank_account_id"),
	CONSTRAINT "cash_transactions_draft_no_number_chk" CHECK ("cash_transactions"."status" <> 'draft' or "cash_transactions"."doc_no" is null),
	CONSTRAINT "cash_transactions_posted_fields_chk" CHECK ("cash_transactions"."status" in ('draft', 'cancelled') or ("cash_transactions"."doc_no" is not null and "cash_transactions"."journal_entry_id" is not null)),
	CONSTRAINT "cash_transactions_cancel_reason_chk" CHECK ("cash_transactions"."status" <> 'cancelled' or "cash_transactions"."reason" is not null)
);
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_account_id_chart_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."chart_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_contra_account_id_chart_accounts_id_fk" FOREIGN KEY ("contra_account_id") REFERENCES "public"."chart_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_counterpart_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("counterpart_bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_accounts_account_idx" ON "bank_accounts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "bank_accounts_branch_idx" ON "bank_accounts" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "cash_transactions_account_date_idx" ON "cash_transactions" USING btree ("bank_account_id","transaction_date");--> statement-breakpoint
CREATE INDEX "cash_transactions_journal_idx" ON "cash_transactions" USING btree ("journal_entry_id");