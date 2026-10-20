CREATE TYPE "public"."bank_reconciliation_status" AS ENUM('draft', 'final');--> statement-breakpoint
CREATE TYPE "public"."bank_statement_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TABLE "bank_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_no" text,
	"bank_account_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"statement_opening_balance" numeric(18, 2) NOT NULL,
	"statement_closing_balance" numeric(18, 2) NOT NULL,
	"book_balance_start" numeric(18, 2),
	"book_balance_end" numeric(18, 2),
	"status" "bank_reconciliation_status" DEFAULT 'draft' NOT NULL,
	"notes" text,
	"finalized_at" timestamp with time zone,
	"finalized_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "bank_reconciliations_docNo_unique" UNIQUE("doc_no"),
	CONSTRAINT "bank_reconciliations_range_chk" CHECK ("bank_reconciliations"."end_date" >= "bank_reconciliations"."start_date"),
	CONSTRAINT "bank_reconciliations_draft_no_number_chk" CHECK ("bank_reconciliations"."status" <> 'draft' or "bank_reconciliations"."doc_no" is null),
	CONSTRAINT "bank_reconciliations_final_fields_chk" CHECK ("bank_reconciliations"."status" <> 'final' or ("bank_reconciliations"."doc_no" is not null and "bank_reconciliations"."finalized_at" is not null and "bank_reconciliations"."finalized_by" is not null and "bank_reconciliations"."book_balance_end" is not null))
);
--> statement-breakpoint
CREATE TABLE "bank_statement_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"statement_date" date NOT NULL,
	"description" text NOT NULL,
	"reference" text,
	"direction" "bank_statement_direction" NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"book_balance_after" numeric(18, 2),
	"reconciliation_id" uuid,
	"matched_cash_transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "bank_statement_lines_amount_chk" CHECK ("bank_statement_lines"."amount" > 0),
	CONSTRAINT "bank_statement_lines_description_chk" CHECK (length(trim("bank_statement_lines"."description")) > 0)
);
--> statement-breakpoint
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_finalized_by_users_id_fk" FOREIGN KEY ("finalized_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_reconciliation_id_bank_reconciliations_id_fk" FOREIGN KEY ("reconciliation_id") REFERENCES "public"."bank_reconciliations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_matched_cash_transaction_id_cash_transactions_id_fk" FOREIGN KEY ("matched_cash_transaction_id") REFERENCES "public"."cash_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_reconciliations_account_range_idx" ON "bank_reconciliations" USING btree ("bank_account_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "bank_statement_lines_account_date_idx" ON "bank_statement_lines" USING btree ("bank_account_id","statement_date");--> statement-breakpoint
CREATE INDEX "bank_statement_lines_reconciliation_idx" ON "bank_statement_lines" USING btree ("reconciliation_id") WHERE "bank_statement_lines"."reconciliation_id" is not null;--> statement-breakpoint
CREATE INDEX "bank_statement_lines_matched_idx" ON "bank_statement_lines" USING btree ("matched_cash_transaction_id") WHERE "bank_statement_lines"."matched_cash_transaction_id" is not null;