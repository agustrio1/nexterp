import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { actorColumns } from "./_actors";
import { primaryId, timestamptz, timestamps } from "./_columns";

/* ------------------------------------------------------------------ */
/* Tahap 8D: Background Jobs (job_runs) — antrean Postgres SKIP LOCKED */
/*   tanpa Redis; artefak ekspor CSV disimpan di baris ini (objek     */
/*   storage di luar cakupan, konsisten catatan 7B).                  */
/* ------------------------------------------------------------------ */
// Klaim worker: UPDATE ... WHERE id = (SELECT ... WHERE status='queued'
// AND runAt <= clock_timestamp() ORDER BY runAt FOR UPDATE SKIP LOCKED). Retry:
// markFailed mengirim job kembali ke queued dengan runAt mundur eksponensial
// sampai maxAttempts tercapai (dead-letter status failed).

/* ----------------------------- Enums ------------------------------ */

export const jobTypeEnum = pgEnum("job_type", [
  "export.report", // ekspor laporan -> CSV (Tahap 8D); extensible via registry
  "payroll.run", // kalkulasi massal run payroll (Tahap 8E); dipindah dari jalur API ke antrean
]);

export const jobStatusEnum = pgEnum("job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

/* ---------------------------- job_runs ---------------------------- */

/**
 * Satu baris = satu pekerjaan. `payload` bebas (divalidasi handler saat jalan);
 * `result` ringkasan sukses; artefak CSV muat penuh di `artifactText`
 * (UTF-8, pemisah koma, sesuai `contentType`/`fileName`).
 * `idempotencyKey` (unik di antara job tak cancelled) mencegah duplikasi enqueue.
 */
export const jobRuns = pgTable(
  "job_runs",
  {
    id: primaryId(),
    type: jobTypeEnum().notNull(),
    status: jobStatusEnum().notNull().default("queued"),
    payload: jsonb().notNull().default({}),
    result: jsonb(),
    artifactText: text(),
    contentType: text(),
    fileName: text(),
    attempts: integer().notNull().default(0),
    maxAttempts: integer().notNull().default(3),
    runAt: timestamptz().notNull().defaultNow(),
    claimedAt: timestamptz(),
    finishedAt: timestamptz(),
    lastError: text(),
    idempotencyKey: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    // Antrian FIFO per status — cocok untuk claim SKIP LOCKED & daftar admin.
    index("job_runs_status_run_at_idx").on(t.status, t.runAt),
    index("job_runs_type_idx").on(t.type),
    // Keyset paginasi listJobs (Tahap 10C): urutan kanonik (created_at, id)
    // dipakai oleh admin list (semua status) dan filter `createdBy` user.
    // PG backward-scan indeks untuk ORDER BY DESC.
    index("job_runs_created_at_id_idx").on(t.createdAt, t.id),
    // Satu kunci idempotensi hanya satu job aktif (cancelled bebas diganti).
    uniqueIndex("job_runs_idempotency_uq")
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null and ${t.status} <> 'cancelled'`),
    // Catatan: `type` enum — tak perlu check trim; PG bahkan menolak trim(enum)
    // (42883 btrim(job_type)) karena tidak ada cast implisit enum -> text.
    check("job_runs_attempts_chk", sql`${t.attempts} >= 0 and ${t.maxAttempts} >= 1`),
    check(
      "job_runs_artifact_chk",
      sql`(${t.artifactText} is null) = (${t.contentType} is null)`,
    ),
  ],
);

export type JobRun = typeof jobRuns.$inferSelect;
export type JobType = (typeof jobTypeEnum.enumValues)[number];
export type JobStatus = (typeof jobStatusEnum.enumValues)[number];
