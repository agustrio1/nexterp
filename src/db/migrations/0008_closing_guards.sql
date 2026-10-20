-- Custom SQL migration (Tahap 4F): penjaga jurnal khusus saldo awal & penutup tahun fiskal.
-- Tidak mengubah struktur tabel (murni trigger), mengikuti pola migrasi guard sebelumnya.
---- Aturan:
--  * source_type 'opening_balance' : entry_date WAJIB = tanggal awal tahun fiskal perujukan,
--    dan periode (saat diposting) harus milik tahun fiskal yang sama. Karena hanya P1 memuat
--    tanggal awal, ini secara efektif memaksa saldo awal ke periode pertama.
--  * source_type 'closing_entry'   : entry_date WAJIB = tanggal akhir tahun fiskal perujukan,
--    dan periode harus milik tahun fiskal yang sama. Mengakomodasi periode penyesuaian (P13)
--    yang berbagi tanggal dengan P12 tanpa salah menolak.
CREATE OR REPLACE FUNCTION erp_journal_special_source_guard() RETURNS trigger AS $$
DECLARE
  fy_start date;
  fy_end date;
BEGIN
  IF NEW.source_type IS NULL OR NEW.source_type NOT IN ('opening_balance', 'closing_entry') THEN
    RETURN NEW;
  END IF;

  SELECT fy.start_date, fy.end_date
    INTO fy_start, fy_end
    FROM fiscal_years fy
   WHERE fy.id = NEW.source_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jurnal % membutuhkan source_id yang merujuk tahun fiskal valid', NEW.source_type;
  END IF;

  IF NEW.source_type = 'opening_balance' THEN
    IF NEW.entry_date <> fy_start THEN
      RAISE EXCEPTION 'Jurnal saldo awal harus bertanggal awal tahun fiskal (%)', fy_start;
    END IF;
  ELSE
    IF NEW.entry_date <> fy_end THEN
      RAISE EXCEPTION 'Jurnal penutup harus bertanggal akhir tahun fiskal (%)', fy_end;
    END IF;
  END IF;

  -- Periode (terisi saat posting) harus berada pada tahun fiskal yang dirujuk sumber.
  IF NEW.period_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM accounting_periods p
     WHERE p.id = NEW.period_id AND p.fiscal_year_id = NEW.source_id
  ) THEN
    RAISE EXCEPTION 'Periode jurnal % harus berada dalam tahun fiskal sumber yang sama', NEW.source_type;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "journal_entries_special_source_guard"
  BEFORE INSERT OR UPDATE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION erp_journal_special_source_guard();
