CREATE TYPE "public"."project_status" AS ENUM('planning', 'in_progress', 'on_hold', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."project_task_status" AS ENUM('pending', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "project_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "project_assignments_role_chk" CHECK (length(trim("project_assignments"."role")) > 0)
);
--> statement-breakpoint
CREATE TABLE "project_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"account_id" uuid,
	"period_key" text,
	"amount" numeric(18, 2) NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "project_budgets_amount_chk" CHECK ("project_budgets"."amount" > 0),
	CONSTRAINT "project_budgets_period_chk" CHECK ("project_budgets"."period_key" IS NULL OR "project_budgets"."period_key" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "project_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"due_date" date,
	"is_completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "project_milestones_name_chk" CHECK (length(trim("project_milestones"."name")) > 0),
	CONSTRAINT "project_milestones_completed_chk" CHECK ("project_milestones"."is_completed" = false or "project_milestones"."completed_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "project_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"assignee_employee_id" uuid,
	"status" "project_task_status" DEFAULT 'pending' NOT NULL,
	"sort_order" integer DEFAULT 1 NOT NULL,
	"weight_percent" numeric(9, 4) DEFAULT '0' NOT NULL,
	"due_date" date,
	"completed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "project_tasks_name_chk" CHECK (length(trim("project_tasks"."name")) > 0),
	CONSTRAINT "project_tasks_order_chk" CHECK ("project_tasks"."sort_order" >= 0),
	CONSTRAINT "project_tasks_weight_chk" CHECK ("project_tasks"."weight_percent" >= 0 and "project_tasks"."weight_percent" <= 100),
	CONSTRAINT "project_tasks_completed_chk" CHECK ("project_tasks"."status" <> 'completed' or "project_tasks"."completed_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"project_number" text,
	"name" text NOT NULL,
	"description" text,
	"cost_center_id" uuid NOT NULL,
	"branch_id" uuid,
	"manager_employee_id" uuid,
	"start_date" date NOT NULL,
	"end_date" date,
	"total_budget" numeric(18, 2),
	"progress_percent" numeric(9, 4) DEFAULT '0' NOT NULL,
	"status" "project_status" DEFAULT 'planning' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "projects_projectNumber_unique" UNIQUE("project_number"),
	CONSTRAINT "projects_code_chk" CHECK (length(trim("projects"."code")) > 0),
	CONSTRAINT "projects_name_chk" CHECK (length(trim("projects"."name")) > 0),
	CONSTRAINT "projects_budget_chk" CHECK ("projects"."total_budget" IS NULL OR "projects"."total_budget" >= 0),
	CONSTRAINT "projects_progress_chk" CHECK ("projects"."progress_percent" >= 0 and "projects"."progress_percent" <= 100),
	CONSTRAINT "projects_dates_chk" CHECK ("projects"."end_date" IS NULL OR "projects"."end_date" >= "projects"."start_date")
);
--> statement-breakpoint
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budgets" ADD CONSTRAINT "project_budgets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budgets" ADD CONSTRAINT "project_budgets_account_id_chart_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."chart_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budgets" ADD CONSTRAINT "project_budgets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budgets" ADD CONSTRAINT "project_budgets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_assignee_employee_id_employees_id_fk" FOREIGN KEY ("assignee_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_manager_employee_id_employees_id_fk" FOREIGN KEY ("manager_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_assignments_project_employee_uq" ON "project_assignments" USING btree ("project_id","employee_id");--> statement-breakpoint
CREATE INDEX "project_assignments_employee_idx" ON "project_assignments" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "project_budgets_project_idx" ON "project_budgets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_budgets_account_idx" ON "project_budgets" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_budgets_proj_acct_period_uq" ON "project_budgets" USING btree ("project_id","account_id","period_key") WHERE "project_budgets"."account_id" is not null and "project_budgets"."period_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "project_budgets_proj_acct_uq" ON "project_budgets" USING btree ("project_id","account_id") WHERE "project_budgets"."account_id" is not null and "project_budgets"."period_key" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "project_budgets_proj_period_uq" ON "project_budgets" USING btree ("project_id","period_key") WHERE "project_budgets"."account_id" is null and "project_budgets"."period_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "project_budgets_proj_uq" ON "project_budgets" USING btree ("project_id") WHERE "project_budgets"."account_id" is null and "project_budgets"."period_key" is null;--> statement-breakpoint
CREATE INDEX "project_milestones_project_idx" ON "project_milestones" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_tasks_project_idx" ON "project_tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_tasks_assignee_idx" ON "project_tasks" USING btree ("assignee_employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_code_uq" ON "projects" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_cost_center_uq" ON "projects" USING btree ("cost_center_id");--> statement-breakpoint
CREATE INDEX "projects_branch_idx" ON "projects" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "projects_manager_idx" ON "projects" USING btree ("manager_employee_id");