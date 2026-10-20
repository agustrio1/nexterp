-- Custom SQL migration file, put your code below! ---- audit_logs append-only: UPDATE selalu ditolak; DELETE hanya untuk baris yang lebih tua dari 7 tahun (retensi).
CREATE OR REPLACE FUNCTION erp_audit_logs_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_logs bersifat append-only: UPDATE ditolak';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD."at" < now() - interval '7 years' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'audit_logs bersifat append-only: DELETE hanya diizinkan untuk data lebih tua dari 7 tahun';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "audit_logs_guard"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION erp_audit_logs_guard();
--> statement-breakpoint
-- Fungsi umum penolak TRUNCATE; dipakai ulang untuk tabel append-only lain (mis. stock_ledger_entries).
CREATE OR REPLACE FUNCTION erp_forbid_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'TRUNCATE ditolak pada tabel %', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "audit_logs_truncate_guard"
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION erp_forbid_truncate();