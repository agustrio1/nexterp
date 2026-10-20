CREATE TYPE "public"."ai_provider" AS ENUM('gemini', 'fake', 'none');--> statement-breakpoint
CREATE TYPE "public"."ai_request_status" AS ENUM('ok', 'error', 'rate_limited', 'disabled', 'unauthorized', 'validation');--> statement-breakpoint
CREATE TABLE "ai_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"status" "ai_request_status" NOT NULL,
	"report_key" text,
	"filters" jsonb,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost" numeric(18, 6) DEFAULT '0' NOT NULL,
	"duration_ms" integer,
	"error_class" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_requests_input_tokens_chk" CHECK ("ai_requests"."input_tokens" >= 0),
	CONSTRAINT "ai_requests_output_tokens_chk" CHECK ("ai_requests"."output_tokens" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "ai_provider" DEFAULT 'none' NOT NULL,
	"model" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"max_input_chars" integer DEFAULT 4000 NOT NULL,
	"max_output_tokens" integer DEFAULT 1000 NOT NULL,
	"rate_limit_per_minute" integer DEFAULT 6 NOT NULL,
	"daily_request_limit" integer DEFAULT 60 NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "ai_settings_max_input_chk" CHECK ("ai_settings"."max_input_chars" >= 1),
	CONSTRAINT "ai_settings_max_output_chk" CHECK ("ai_settings"."max_output_tokens" >= 1),
	CONSTRAINT "ai_settings_rpm_chk" CHECK ("ai_settings"."rate_limit_per_minute" >= 0),
	CONSTRAINT "ai_settings_daily_chk" CHECK ("ai_settings"."daily_request_limit" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_requests_user_created_idx" ON "ai_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_requests_created_idx" ON "ai_requests" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_settings_singleton_uq" ON "ai_settings" USING btree ("singleton");