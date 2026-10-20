CREATE INDEX "users_created_at_id_idx" ON "users" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "exchange_rates_rate_date_id_idx" ON "exchange_rates" USING btree ("rate_date","id");--> statement-breakpoint
CREATE INDEX "job_runs_created_at_id_idx" ON "job_runs" USING btree ("created_at","id");