CREATE TYPE "public"."component_basis" AS ENUM('fixed', 'percentage_of_base', 'statutory', 'attendance');--> statement-breakpoint
CREATE TYPE "public"."party_share" AS ENUM('employee', 'employer', 'both');--> statement-breakpoint
CREATE TYPE "public"."pay_frequency" AS ENUM('monthly', 'bimonthly', 'weekly');--> statement-breakpoint
CREATE TYPE "public"."payroll_period_status" AS ENUM('draft', 'finalized', 'posted', 'closed');--> statement-breakpoint
CREATE TYPE "public"."payroll_run_status" AS ENUM('draft', 'calculated', 'approved', 'posted', 'cancelled', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."payslip_status" AS ENUM('issued', 'void');--> statement-breakpoint
CREATE TYPE "public"."salary_component_kind" AS ENUM('earning', 'deduction');--> statement-breakpoint
CREATE TYPE "public"."statutory_kind" AS ENUM('pph21', 'bpjs_kesehatan', 'bpjs_jht', 'bpjs_jp', 'bpjs_kk', 'bpjs_jkm', 'other');--> statement-breakpoint
CREATE TABLE "employee_compensations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"structure_id" uuid,
	"base_salary" numeric(18, 2) NOT NULL,
	"effective_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "employee_compensations_base_chk" CHECK ("employee_compensations"."base_salary" > 0)
);
--> statement-breakpoint
CREATE TABLE "payroll_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"period_id" uuid,
	"component_id" uuid,
	"kind" "salary_component_kind" NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"effective_from" date NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "payroll_adjustments_amount_chk" CHECK ("payroll_adjustments"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payroll_component_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"amount" numeric(18, 2),
	"percent_value" numeric(9, 4),
	"effective_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "payroll_component_values_amount_chk" CHECK ("payroll_component_values"."amount" IS NULL OR "payroll_component_values"."amount" >= 0),
	CONSTRAINT "payroll_component_values_percent_chk" CHECK ("payroll_component_values"."percent_value" IS NULL OR "payroll_component_values"."percent_value" >= 0),
	CONSTRAINT "payroll_component_values_value_chk" CHECK ("payroll_component_values"."amount" IS NOT NULL OR "payroll_component_values"."percent_value" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "payroll_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"branch_id" uuid,
	"status" "payroll_period_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "payroll_periods_code_chk" CHECK (length(trim("payroll_periods"."code")) > 0),
	CONSTRAINT "payroll_periods_name_chk" CHECK (length(trim("payroll_periods"."name")) > 0),
	CONSTRAINT "payroll_periods_range_chk" CHECK ("payroll_periods"."period_end" >= "payroll_periods"."period_start")
);
--> statement-breakpoint
CREATE TABLE "payroll_run_item_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_item_id" uuid NOT NULL,
	"component_id" uuid,
	"statutory_rule_id" uuid,
	"label" text NOT NULL,
	"kind" "salary_component_kind" NOT NULL,
	"basis_snapshot" jsonb,
	"amount" numeric(18, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "payroll_run_item_components_label_chk" CHECK (length(trim("payroll_run_item_components"."label")) > 0),
	CONSTRAINT "payroll_run_item_components_amount_chk" CHECK ("payroll_run_item_components"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payroll_run_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"gross_earnings" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_deductions" numeric(18, 2) DEFAULT '0' NOT NULL,
	"net_pay" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "payroll_run_items_amounts_chk" CHECK ("payroll_run_items"."gross_earnings" >= 0 and "payroll_run_items"."total_deductions" >= 0 and "payroll_run_items"."net_pay" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_no" text,
	"period_id" uuid NOT NULL,
	"branch_id" uuid,
	"status" "payroll_run_status" DEFAULT 'draft' NOT NULL,
	"employee_count" integer DEFAULT 0 NOT NULL,
	"total_earnings" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_deductions" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_net" numeric(18, 2) DEFAULT '0' NOT NULL,
	"journal_entry_id" uuid,
	"payable_journal_entry_id" uuid,
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
	CONSTRAINT "payroll_runs_docNo_unique" UNIQUE("doc_no"),
	CONSTRAINT "payroll_runs_docno_chk" CHECK (("payroll_runs"."status" in ('draft', 'calculated', 'approved', 'cancelled') and "payroll_runs"."doc_no" is null) or ("payroll_runs"."status" in ('posted', 'reversed') and "payroll_runs"."doc_no" is not null)),
	CONSTRAINT "payroll_runs_posted_chk" CHECK ("payroll_runs"."status" <> 'posted' or ("payroll_runs"."employee_count" > 0 and "payroll_runs"."total_earnings" > 0 and "payroll_runs"."journal_entry_id" is not null)),
	CONSTRAINT "payroll_runs_totals_chk" CHECK ("payroll_runs"."total_earnings" >= 0 and "payroll_runs"."total_deductions" >= 0 and "payroll_runs"."total_net" >= 0),
	CONSTRAINT "payroll_runs_cancel_chk" CHECK ("payroll_runs"."status" <> 'cancelled' or ("payroll_runs"."cancelled_at" is not null and "payroll_runs"."reason" is not null)),
	CONSTRAINT "payroll_runs_reverse_chk" CHECK ("payroll_runs"."status" <> 'reversed' or ("payroll_runs"."reversed_at" is not null and "payroll_runs"."reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "payslips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_no" text NOT NULL,
	"run_item_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"period_label" text NOT NULL,
	"gross_earnings" numeric(18, 2) NOT NULL,
	"total_deductions" numeric(18, 2) NOT NULL,
	"net_pay" numeric(18, 2) NOT NULL,
	"snapshot" jsonb,
	"status" "payslip_status" DEFAULT 'issued' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "payslips_docNo_unique" UNIQUE("doc_no"),
	CONSTRAINT "payslips_period_chk" CHECK (length(trim("payslips"."period_label")) > 0),
	CONSTRAINT "payslips_amounts_chk" CHECK ("payslips"."gross_earnings" >= 0 and "payslips"."total_deductions" >= 0 and "payslips"."net_pay" >= 0)
);
--> statement-breakpoint
CREATE TABLE "salary_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" "salary_component_kind" NOT NULL,
	"basis" "component_basis" NOT NULL,
	"statutory_kind" "statutory_kind",
	"order_no" integer DEFAULT 1 NOT NULL,
	"include_in_tax_base" boolean DEFAULT false NOT NULL,
	"include_in_bpjs_base" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "salary_components_code_chk" CHECK (length(trim("salary_components"."code")) > 0),
	CONSTRAINT "salary_components_name_chk" CHECK (length(trim("salary_components"."name")) > 0),
	CONSTRAINT "salary_components_order_chk" CHECK ("salary_components"."order_no" >= 1)
);
--> statement-breakpoint
CREATE TABLE "salary_structure_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"structure_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "salary_structures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"pay_frequency" "pay_frequency" DEFAULT 'monthly' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "salary_structures_code_chk" CHECK (length(trim("salary_structures"."code")) > 0),
	CONSTRAINT "salary_structures_name_chk" CHECK (length(trim("salary_structures"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "statutory_rule_brackets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"order_no" integer NOT NULL,
	"min_amount" numeric(18, 2) NOT NULL,
	"max_amount" numeric(18, 2),
	"rate" numeric(9, 4) NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "statutory_rule_brackets_order_chk" CHECK ("statutory_rule_brackets"."order_no" >= 1),
	CONSTRAINT "statutory_rule_brackets_min_chk" CHECK ("statutory_rule_brackets"."min_amount" >= 0),
	CONSTRAINT "statutory_rule_brackets_range_chk" CHECK ("statutory_rule_brackets"."max_amount" IS NULL OR "statutory_rule_brackets"."max_amount" > "statutory_rule_brackets"."min_amount"),
	CONSTRAINT "statutory_rule_brackets_rate_chk" CHECK ("statutory_rule_brackets"."rate" >= 0),
	CONSTRAINT "statutory_rule_brackets_source_chk" CHECK (length(trim("statutory_rule_brackets"."source")) > 0)
);
--> statement-breakpoint
CREATE TABLE "statutory_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"kind" "statutory_kind" NOT NULL,
	"party" "party_share" NOT NULL,
	"name" text NOT NULL,
	"rate" numeric(9, 4),
	"flat_amount" numeric(18, 2),
	"wage_cap" numeric(18, 2),
	"below_wage_cap" boolean,
	"source" text NOT NULL,
	"effective_from" date NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "statutory_rules_code_chk" CHECK (length(trim("statutory_rules"."code")) > 0),
	CONSTRAINT "statutory_rules_name_chk" CHECK (length(trim("statutory_rules"."name")) > 0),
	CONSTRAINT "statutory_rules_source_chk" CHECK (length(trim("statutory_rules"."source")) > 0),
	CONSTRAINT "statutory_rules_rate_chk" CHECK ("statutory_rules"."rate" IS NULL OR "statutory_rules"."rate" >= 0),
	CONSTRAINT "statutory_rules_flat_chk" CHECK ("statutory_rules"."flat_amount" IS NULL OR "statutory_rules"."flat_amount" >= 0),
	CONSTRAINT "statutory_rules_cap_chk" CHECK ("statutory_rules"."wage_cap" IS NULL OR "statutory_rules"."wage_cap" >= 0)
);
--> statement-breakpoint
ALTER TABLE "employee_compensations" ADD CONSTRAINT "employee_compensations_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_compensations" ADD CONSTRAINT "employee_compensations_structure_id_salary_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."salary_structures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_compensations" ADD CONSTRAINT "employee_compensations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_compensations" ADD CONSTRAINT "employee_compensations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_period_id_payroll_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_component_id_salary_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."salary_components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_component_values" ADD CONSTRAINT "payroll_component_values_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_component_values" ADD CONSTRAINT "payroll_component_values_component_id_salary_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."salary_components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_component_values" ADD CONSTRAINT "payroll_component_values_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_component_values" ADD CONSTRAINT "payroll_component_values_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_item_components" ADD CONSTRAINT "payroll_run_item_components_run_item_id_payroll_run_items_id_fk" FOREIGN KEY ("run_item_id") REFERENCES "public"."payroll_run_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_item_components" ADD CONSTRAINT "payroll_run_item_components_component_id_salary_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."salary_components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_item_components" ADD CONSTRAINT "payroll_run_item_components_statutory_rule_id_statutory_rules_id_fk" FOREIGN KEY ("statutory_rule_id") REFERENCES "public"."statutory_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_item_components" ADD CONSTRAINT "payroll_run_item_components_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_item_components" ADD CONSTRAINT "payroll_run_item_components_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_items" ADD CONSTRAINT "payroll_run_items_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_items" ADD CONSTRAINT "payroll_run_items_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_items" ADD CONSTRAINT "payroll_run_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_items" ADD CONSTRAINT "payroll_run_items_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_period_id_payroll_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_payable_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("payable_journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_calculated_by_users_id_fk" FOREIGN KEY ("calculated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_run_item_id_payroll_run_items_id_fk" FOREIGN KEY ("run_item_id") REFERENCES "public"."payroll_run_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_components" ADD CONSTRAINT "salary_components_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_components" ADD CONSTRAINT "salary_components_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structure_components" ADD CONSTRAINT "salary_structure_components_structure_id_salary_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."salary_structures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structure_components" ADD CONSTRAINT "salary_structure_components_component_id_salary_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."salary_components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structure_components" ADD CONSTRAINT "salary_structure_components_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structure_components" ADD CONSTRAINT "salary_structure_components_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statutory_rule_brackets" ADD CONSTRAINT "statutory_rule_brackets_rule_id_statutory_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."statutory_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statutory_rule_brackets" ADD CONSTRAINT "statutory_rule_brackets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statutory_rule_brackets" ADD CONSTRAINT "statutory_rule_brackets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statutory_rules" ADD CONSTRAINT "statutory_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statutory_rules" ADD CONSTRAINT "statutory_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_compensations_employee_effective_uq" ON "employee_compensations" USING btree ("employee_id","effective_from");--> statement-breakpoint
CREATE INDEX "employee_compensations_structure_idx" ON "employee_compensations" USING btree ("structure_id");--> statement-breakpoint
CREATE INDEX "payroll_adjustments_employee_idx" ON "payroll_adjustments" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "payroll_adjustments_period_idx" ON "payroll_adjustments" USING btree ("period_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_component_values_employee_component_eff_uq" ON "payroll_component_values" USING btree ("employee_id","component_id","effective_from");--> statement-breakpoint
CREATE INDEX "payroll_component_values_component_idx" ON "payroll_component_values" USING btree ("component_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_periods_code_uq" ON "payroll_periods" USING btree ("code");--> statement-breakpoint
CREATE INDEX "payroll_periods_status_start_idx" ON "payroll_periods" USING btree ("status","period_start");--> statement-breakpoint
CREATE INDEX "payroll_run_item_components_item_idx" ON "payroll_run_item_components" USING btree ("run_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_run_items_run_employee_uq" ON "payroll_run_items" USING btree ("run_id","employee_id");--> statement-breakpoint
CREATE INDEX "payroll_run_items_employee_idx" ON "payroll_run_items" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "payroll_runs_period_idx" ON "payroll_runs" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "payroll_runs_status_idx" ON "payroll_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "payslips_run_item_uq" ON "payslips" USING btree ("run_item_id");--> statement-breakpoint
CREATE INDEX "payslips_employee_idx" ON "payslips" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "payslips_status_idx" ON "payslips" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "salary_components_code_uq" ON "salary_components" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "salary_structure_components_pair_uq" ON "salary_structure_components" USING btree ("structure_id","component_id");--> statement-breakpoint
CREATE INDEX "salary_structure_components_component_idx" ON "salary_structure_components" USING btree ("component_id");--> statement-breakpoint
CREATE UNIQUE INDEX "salary_structures_code_uq" ON "salary_structures" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "statutory_rule_brackets_rule_order_uq" ON "statutory_rule_brackets" USING btree ("rule_id","order_no");--> statement-breakpoint
CREATE UNIQUE INDEX "statutory_rules_code_uq" ON "statutory_rules" USING btree ("code");--> statement-breakpoint
CREATE INDEX "statutory_rules_kind_effective_idx" ON "statutory_rules" USING btree ("kind","effective_from");