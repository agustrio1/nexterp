-- Custom SQL migration file, put your code below! ---- Tahun fiskal tidak boleh tumpang tindih.
ALTER TABLE "fiscal_years"
  ADD CONSTRAINT "fiscal_years_no_overlap"
  EXCLUDE USING gist (daterange("start_date", "end_date", '[]') WITH &&);
--> statement-breakpoint
-- Periode reguler (1..12) tidak boleh tumpang tindih. Periode 13 (penyesuaian) dikecualikan.
ALTER TABLE "accounting_periods"
  ADD CONSTRAINT "accounting_periods_no_overlap"
  EXCLUDE USING gist (daterange("start_date", "end_date", '[]') WITH &&)
  WHERE ("period_no" <= 12);