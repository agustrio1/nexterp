-- =====================================================================
-- Tahap 10C — Partisi bulanan `audit_logs` (RANGE pada kolom `at`)
-- =====================================================================
-- TUJUAN
--   Mengubah `audit_logs` menjadi tabel terpartisi per bulan berdasarkan
--   `at` (timestamptz), agar:
--     1) retensi 7 tahun bisa dieksekusi via DROP PARTITION (DDL) tanpa
--        memicu trigger append-only;
--     2) query dengan filter waktu memakai partition pruning;
--     3) pertumbuhan indeks & vacuum tetap terkendali saat volume naik.
--
-- STATUS BERKAS
--   SIAP-JALANKAN tetapi TIDAK dijalankan otomatis oleh `db:migrate`
--   (Drizzle Kit hanya membaca file yang terdaftar di
--   `src/db/migrations/meta/_journal.json`). Eksekusi manual dengan
--   persetujuan operator setelah backup Neon diverifikasi.
--
-- PRASYARAT
--   * Neon PostgreSQL >= 14 (partitioned index + FK pada partitioned
--     table sudah didukung penuh sejak PG 11/12).
--   * Tidak ada sesi aktif yang menulis ke `audit_logs` — script
--     mengambil ACCESS EXCLUSIVE lock di awal.
--   * Backup/restore point Neon dibuat & diverifikasi sebelumnya.
--     Lihat docs/OPERATIONS.md §Backup & Restore.
--
-- IDEMPOTEN
--   Script mendeteksi status partisi di baris pertama; bila sudah
--   terpartisi, transaksi RAISE EXCEPTION + ROLLBACK tanpa efek
--   samping. Operator dapat menjalankan ulang dengan aman.
--
-- ROLBACK
--   Bila terjadi kegagalan di tengah, satu-satunya transaksi PG
--   akan rollback penuh — `audit_logs` lama tetap utuh. Tidak
--   perlu langkah pemulihan terpisah.
--
-- CARA JALANKAN
--   psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 \
--        -f src/db/manual/audit_logs_monthly_partition.sql
--   atau melalui Neon SQL Editor (paste seluruh isi, Run).
--
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- 0. Guard: abort jika sudah terpartisi
-- ---------------------------------------------------------------------
DO $$
DECLARE
  already_partitioned boolean;
BEGIN
  SELECT (p.partrelid IS NOT NULL)
    INTO already_partitioned
    FROM pg_class c
    LEFT JOIN pg_partitioned_table p ON p.partrelid = c.oid
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relname = 'audit_logs';

  IF already_partitioned IS NULL THEN
    RAISE EXCEPTION 'audit_logs tidak ditemukan — jalankan migrasi inti 0002_core_system terlebih dahulu';
  END IF;

  IF already_partitioned THEN
    RAISE EXCEPTION 'audit_logs sudah terpartisi — script ini tidak perlu dijalankan lagi';
  END IF;

  -- Lock lebih awal supaya tidak ada writer lain saat rename.
  LOCK TABLE audit_logs IN ACCESS EXCLUSIVE MODE;
END
$$;

-- ---------------------------------------------------------------------
-- 1. Simpan tabel lama sebagai _legacy (sumber data)
-- ---------------------------------------------------------------------
ALTER TABLE "audit_logs" RENAME TO "audit_logs_legacy";

-- ---------------------------------------------------------------------
-- 2. Buat ulang `audit_logs` sebagai partitioned table (RANGE on `at`)
--    Kolom, default, dan constraint identik dengan 0002_core_system.
--    PK WAJIB memuat key partisi (`at`).
-- ---------------------------------------------------------------------
CREATE TABLE "audit_logs" (
  "id"          uuid DEFAULT gen_random_uuid() NOT NULL,
  "at"          timestamp with time zone DEFAULT now() NOT NULL,
  "actor_id"    uuid,
  "action"      text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id"   text,
  "before"      jsonb,
  "after"       jsonb,
  "ip"          inet,
  "user_agent"  text,
  "request_id"  text,
  CONSTRAINT "audit_logs_id_at_pk" PRIMARY KEY ("id", "at")
) PARTITION BY RANGE ("at");

-- FK ke users — dipertahankan semantik ON DELETE NO ACTION.
ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_actor_id_users_id_fk"
  FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Indeks pada parent — PG akan menyalin ke setiap child partition
-- saat partition dibuat (partition-local index).
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type", "entity_id", "at");
CREATE INDEX "audit_logs_actor_idx"  ON "audit_logs" USING btree ("actor_id", "at");
CREATE INDEX "audit_logs_at_idx"     ON "audit_logs" USING btree ("at");

-- ---------------------------------------------------------------------
-- 3. Pindahkan trigger guard (append-only + truncate)
--    Trigger lama ikut ter-rename ke _legacy — drop, lalu pasang pada
--    parent. PG 13+ mendukung row-level & statement-level trigger
--    pada partitioned table (dieksekusi per partition).
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS "audit_logs_guard"         ON "audit_logs";
DROP TRIGGER IF EXISTS "audit_logs_truncate_guard" ON "audit_logs";

-- Fungsi sudah ada dari 0003 — tidak dibuat ulang di sini.
CREATE TRIGGER "audit_logs_guard"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION erp_audit_logs_guard();

CREATE TRIGGER "audit_logs_truncate_guard"
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION erp_forbid_truncate();

-- ---------------------------------------------------------------------
-- 4. Pre-create partisi bulanan
--    Rentang: dari bulan pertama yang berisi data legacy sampai
--    12 bulan ke depan. DEFAULT partition menangkap baris yang
--    jatuh di luar rentang (mis. clock skew atau backfill historis).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  min_month timestamp with time zone;
  max_month timestamp with time zone;
  cursor    timestamp with time zone;
  part_name text;
BEGIN
  SELECT date_trunc('month', COALESCE(min(at), now()))
    INTO min_month
    FROM audit_logs_legacy;

  max_month := date_trunc('month', now()) + interval '12 months';
  cursor    := min_month;

  WHILE cursor < max_month LOOP
    part_name := 'audit_logs_' || to_char(cursor, 'YYYY_MM');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)',
      part_name,
      cursor,
      cursor + interval '1 month'
    );
    cursor := cursor + interval '1 month';
  END LOOP;
END
$$;

-- DEFAULT partition — menangkap baris di luar partisi eksplisit.
CREATE TABLE IF NOT EXISTS "audit_logs_default"
  PARTITION OF "audit_logs" DEFAULT;

-- ---------------------------------------------------------------------
-- 5. Migrasi data legacy ke partisi baru
--    INSERT routed otomatis oleh PG ke partition yang cocok; baris
--    tanpa partition target masuk DEFAULT.
-- ---------------------------------------------------------------------
INSERT INTO "audit_logs" (
  "id", "at", "actor_id", "action", "entity_type", "entity_id",
  "before", "after", "ip", "user_agent", "request_id"
)
SELECT
  "id", "at", "actor_id", "action", "entity_type", "entity_id",
  "before", "after", "ip", "user_agent", "request_id"
FROM "audit_logs_legacy";

-- ---------------------------------------------------------------------
-- 6. Hapus tabel legacy + trigger lama (data sudah berpindah)
-- ---------------------------------------------------------------------
DROP TABLE "audit_logs_legacy";

-- ---------------------------------------------------------------------
-- 7. Refresh planner statistics
-- ---------------------------------------------------------------------
ANALYZE "audit_logs";

COMMIT;

-- =====================================================================
-- PASCA-EKSEKUSI (WAJIB DIDOKUMENTASIKAN DI RUNBOOK)
-- =====================================================================
-- * Pembuatan partisi bulan-bulan berikutnya: jalankan fungsi helper
--   di bawah (cron mingguan / pg_cron) agar tidak menumpuk di DEFAULT.
--     SELECT erp_audit_create_next_partition(2);   -- 2 bulan ke depan
-- * Retensi: partisi > 7 tahun bisa di-DROP via:
--     ALTER TABLE audit_logs DETACH PARTITION audit_logs_YYYY_MM;
--     DROP TABLE audit_logs_YYYY_MM;
--   Ini bypass trigger append-only (DDL, bukan DELETE).
-- * Pantau ukuran DEFAULT partition — harusnya selalu ~0 baris.
--   Kalau bertambah, artinya ada data masuk di luar rentang
--   partisi yang telah dibuat; perluas loop pre-create.
-- =====================================================================

-- Helper: create N bulan ke depan dari bulan saat ini (idempoten).
CREATE OR REPLACE FUNCTION erp_audit_create_next_partition(months_forward integer DEFAULT 2)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  i         integer;
  target    timestamp with time zone;
  part_name text;
BEGIN
  IF months_forward IS NULL OR months_forward < 0 OR months_forward > 24 THEN
    RAISE EXCEPTION 'erp_audit_create_next_partition: months_forward harus 0..24 (dapat: %)', months_forward;
  END IF;

  FOR i IN 0..months_forward LOOP
    target := date_trunc('month', now()) + (i || ' months')::interval;
    part_name := 'audit_logs_' || to_char(target, 'YYYY_MM');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)',
      part_name,
      target,
      target + interval '1 month'
    );
  END LOOP;
END
$$;

-- Verifikasi pasca-migrasi (baris terakhir sebelum COMMIT tidak bisa
-- melihat hasil, jadi jalankan query berikut manual bila perlu):
--   SELECT c.relname, c.relpersistence
--     FROM pg_class c JOIN pg_partitioned_table p ON p.partrelid = c.oid
--    WHERE c.relname = 'audit_logs';
--   SELECT count(*) FROM audit_logs_default;   -- seharusnya kecil / nol
--   SELECT relname, pg_size_pretty(pg_total_relation_size(oid))
--     FROM pg_class WHERE relname LIKE 'audit_logs_%' ORDER BY relname;
