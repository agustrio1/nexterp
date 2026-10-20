CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('export.report');--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "job_type" NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"artifact_text" text,
	"content_type" text,
	"file_name" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_error" text,
	"idempotency_key" text,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "job_runs_attempts_chk" CHECK ("job_runs"."attempts" >= 0 and "job_runs"."max_attempts" >= 1),
	CONSTRAINT "job_runs_artifact_chk" CHECK (("job_runs"."artifact_text" is null) = ("job_runs"."content_type" is null))
);
--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_runs_status_run_at_idx" ON "job_runs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "job_runs_type_idx" ON "job_runs" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "job_runs_idempotency_uq" ON "job_runs" USING btree ("idempotency_key") WHERE "job_runs"."idempotency_key" is not null and "job_runs"."status" <> 'cancelled';