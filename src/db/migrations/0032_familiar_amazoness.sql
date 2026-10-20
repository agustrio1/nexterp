CREATE TABLE "api_rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "api_rate_limits_key_pk" PRIMARY KEY("key"),
	CONSTRAINT "api_rate_limits_count_chk" CHECK ("api_rate_limits"."count" >= 0)
);
--> statement-breakpoint
CREATE INDEX "api_rate_limits_window_idx" ON "api_rate_limits" USING btree ("window_start");