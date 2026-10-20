-- Custom SQL migration file, put your code below! ---- Penjaga header jurnal: INSERT hanya draf; posting divalidasi; jurnal terposting imutabel.
CREATE OR REPLACE FUNCTION erp_journal_entries_guard() RETURNS trigger AS $$
DECLARE
  line_debit numeric;
  line_credit numeric;
  line_count integer;
  period_status text;
  period_start date;
  period_end date;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'Jurnal baru harus berstatus draft; jurnal terposting hanya lahir dari posting draf';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('posted', 'reversed') THEN
      RAISE EXCEPTION 'Jurnal % tidak dapat dihapus karena berstatus %', OLD.doc_no, OLD.status;
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF OLD.status = 'posted' THEN
    -- Satu-satunya perubahan yang lolos: status menjadi reversed (kolom lain tidak berubah).
    IF NEW.status = 'reversed'
       AND (to_jsonb(NEW) - 'status' - 'updated_at' - 'updated_by')
         = (to_jsonb(OLD) - 'status' - 'updated_at' - 'updated_by') THEN
      IF NOT EXISTS (
        SELECT 1 FROM journal_entries r WHERE r.reversal_of_id = OLD.id AND r.status = 'posted'
      ) THEN
        RAISE EXCEPTION 'Jurnal % hanya dapat berstatus reversed bila reversalnya sudah terposting', OLD.doc_no;
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Jurnal % sudah terposting dan tidak dapat diubah; gunakan reversal', OLD.doc_no;
  END IF;

  IF OLD.status IN ('reversed', 'cancelled') THEN
    RAISE EXCEPTION 'Jurnal berstatus % tidak dapat diubah', OLD.status;
  END IF;

  -- OLD.status = 'draft'
  IF NEW.status = 'reversed' THEN
    RAISE EXCEPTION 'Draf tidak dapat langsung berstatus reversed';
  END IF;

  IF NEW.status = 'posted' THEN
    SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0), COUNT(*)
      INTO line_debit, line_credit, line_count
      FROM journal_entry_lines WHERE entry_id = NEW.id;

    IF line_count < 2 THEN
      RAISE EXCEPTION 'Jurnal harus memiliki minimal dua baris untuk diposting';
    END IF;
    IF line_debit <> line_credit THEN
      RAISE EXCEPTION 'Jurnal tidak seimbang: debit % kredit %', line_debit, line_credit;
    END IF;
    IF NEW.total_debit <> line_debit OR NEW.total_credit <> line_credit THEN
      RAISE EXCEPTION 'Total pada header jurnal tidak sama dengan jumlah baris';
    END IF;

    SELECT p.status::text, p.start_date, p.end_date
      INTO period_status, period_start, period_end
      FROM accounting_periods p WHERE p.id = NEW.period_id;

    IF period_status IS NULL THEN
      RAISE EXCEPTION 'Periode jurnal tidak ditemukan';
    END IF;
    IF period_status = 'closed' THEN
      RAISE EXCEPTION 'Periode akuntansi sudah ditutup; jurnal tidak dapat diposting';
    END IF;
    IF NEW.entry_date < period_start OR NEW.entry_date > period_end THEN
      RAISE EXCEPTION 'Tanggal jurnal % berada di luar rentang periode (% s.d. %)',
        NEW.entry_date, period_start, period_end;
    END IF;

    IF NEW.reversal_of_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM journal_entries o WHERE o.id = NEW.reversal_of_id AND o.status = 'posted'
      ) THEN
        RAISE EXCEPTION 'Jurnal yang direversal harus berstatus posted';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "journal_entries_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION erp_journal_entries_guard();
--> statement-breakpoint
-- Penjaga baris jurnal: hanya boleh berubah selama jurnal induk berstatus draft.
CREATE OR REPLACE FUNCTION erp_journal_entry_lines_guard() RETURNS trigger AS $$
DECLARE
  parent_id uuid;
  parent_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.entry_id <> OLD.entry_id THEN
    RAISE EXCEPTION 'Baris jurnal tidak dapat dipindahkan ke jurnal lain';
  END IF;

  IF TG_OP = 'DELETE' THEN
    parent_id := OLD.entry_id;
  ELSE
    parent_id := NEW.entry_id;
  END IF;

  -- FOR SHARE: bila posting sedang berjalan (baris induk terkunci), perubahan baris menunggu lalu ditolak.
  SELECT status::text INTO parent_status FROM journal_entries WHERE id = parent_id FOR SHARE;

  IF parent_status IS NULL THEN
    RAISE EXCEPTION 'Jurnal induk baris tidak ditemukan';
  END IF;
  IF parent_status <> 'draft' THEN
    RAISE EXCEPTION 'Baris jurnal hanya dapat diubah selama jurnal berstatus draft (status saat ini: %)', parent_status;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "journal_entry_lines_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "journal_entry_lines"
  FOR EACH ROW EXECUTE FUNCTION erp_journal_entry_lines_guard();
--> statement-breakpoint
CREATE TRIGGER "journal_entries_truncate_guard"
  BEFORE TRUNCATE ON "journal_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION erp_forbid_truncate();
--> statement-breakpoint
CREATE TRIGGER "journal_entry_lines_truncate_guard"
  BEFORE TRUNCATE ON "journal_entry_lines"
  FOR EACH STATEMENT EXECUTE FUNCTION erp_forbid_truncate();
--> statement-breakpoint
-- Tipe akun tidak boleh berubah setelah dipakai baris jurnal.
CREATE OR REPLACE FUNCTION erp_chart_accounts_type_guard() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM journal_entry_lines WHERE account_id = OLD.id) THEN
    RAISE EXCEPTION 'Tipe akun % tidak dapat diubah karena sudah dipakai jurnal', OLD.code;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "chart_accounts_type_guard"
  BEFORE UPDATE OF type ON "chart_accounts"
  FOR EACH ROW WHEN (OLD.type IS DISTINCT FROM NEW.type)
  EXECUTE FUNCTION erp_chart_accounts_type_guard();