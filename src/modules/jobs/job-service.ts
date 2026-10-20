import { and, desc, eq, ne, sql } from "drizzle-orm";

import { jobRuns, type JobRun, type JobType } from "@/db/schema";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { businessRule, forbidden, notFound } from "@/server/errors";
import { nextDocumentNumber } from "@/server/numbering";
import { findExportEntry } from "@/modules/reporting/export-catalog";
import { decodeCursor, keysetPage } from "@/server/cursor";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { z } from "zod";

import { assertCan, inTx, lockJob, requireJobForActor, type Tx } from "./_refs";
import { JOB_HANDLERS, type JobOutcome } from "./handlers";
import type {
  EnqueueExportInput,
  EnqueuePayrollRunInput,
  ExportPayload,
  ListJobsQuery,
  PayrollRunPayload,
} from "./schemas";

/* ------------------------------------------------------------------ */
/* Antrean job latar belakang (Tahap 8D).                              */
/* Postgres saja: klaim pakai FOR UPDATE SKIP LOCKED, retry pakai      */
/* `runAt` yang dimundur eksponensial, dead-letter pada `failed`.       */
/* ------------------------------------------------------------------ */

/** Jeda retry dasar; dikali 2^(attempts-1) sehingga 30s, 60s, 120s, ... */
const BACKOFF_BASE_MS = 30_000;
const MAX_ERROR_LENGTH = 500;

/**
 * Izin yang harus dipegang pemroses (worker/operator) untuk mengklaim job satu
 * jenis. `Record<JobType, PermissionCode>` memaksa jenis baru disertai izinnya.
 * Worker hanya mengklaim job jenis yang dia berhak — spesialisasi alami tanpa
 * kolom tambahan.
 */
const JOB_EXECUTOR_PERMISSION: Record<JobType, PermissionCode> = {
  "export.report": "reporting.exports.manage",
  "payroll.run": "payroll.runs.manage",
};

/** Ringkasan job untuk API — isi artefak CSV tidak ikut terbawa. */
function summarize(job: JobRun) {
  const { artifactText, ...rest } = job;
  return { ...rest, hasArtifact: artifactText !== null };
}

/** Kolom daftar (tanpa `artifactText`, diganti penanda keberadaan artefak). */
const listColumns = {
  id: jobRuns.id,
  type: jobRuns.type,
  status: jobRuns.status,
  payload: jobRuns.payload,
  result: jobRuns.result,
  fileName: jobRuns.fileName,
  contentType: jobRuns.contentType,
  attempts: jobRuns.attempts,
  maxAttempts: jobRuns.maxAttempts,
  runAt: jobRuns.runAt,
  claimedAt: jobRuns.claimedAt,
  finishedAt: jobRuns.finishedAt,
  lastError: jobRuns.lastError,
  idempotencyKey: jobRuns.idempotencyKey,
  createdAt: jobRuns.createdAt,
  createdBy: jobRuns.createdBy,
  hasArtifact: sql<boolean>`(${jobRuns.artifactText} is not null)`,
};

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_ERROR_LENGTH);
}

/* ------------------------------ Enqueue ------------------------------ */

/**
 * Antrekan ekspor laporan. `reportKey` harus ada di katalog dan pemanggil wajib
 * memegang izin laporan sumber (fail-fast — kegagalan ketahuan di API, bukan
 * setelah job diklaim). `idempotencyKey` yang sama mengembalikan job yang sudah
 * ada tanpa membuat baris baru (indeks unik parsial menjaga di level DB).
 */
export async function enqueueExport(
  actor: AuthContext,
  input: EnqueueExportInput,
  externalTx?: Tx,
) {
  assertCan(actor, "reporting.exports.manage");

  const entry = findExportEntry(input.reportKey);
  if (!entry) throw notFound(`Laporan ekspor tidak dikenal: ${input.reportKey}`);
  assertCan(actor, entry.permission);

  const query = entry.parseQuery(input.query ?? {});
  const payload: ExportPayload = { reportKey: entry.key, query: query as Record<string, unknown> };

  return inTx(externalTx, async (tx) => {
    if (input.idempotencyKey) {
      const [existing] = await tx
        .select()
        .from(jobRuns)
        .where(
          and(
            eq(jobRuns.idempotencyKey, input.idempotencyKey),
            ne(jobRuns.status, "cancelled"),
          ),
        )
        .limit(1);
      if (existing) return summarize(existing);
    }

    const runAt = input.runAt ? new Date(`${input.runAt}T00:00:00Z`) : new Date();
    const docNo = await nextDocumentNumber(tx, "export_job", { date: isoDay(runAt) });

    const [created] = await tx
      .insert(jobRuns)
      .values({
        type: "export.report",
        status: "queued",
        payload,
        fileName: `${entry.key}-${docNo}.csv`,
        runAt,
        maxAttempts: input.maxAttempts ?? 3,
        idempotencyKey: input.idempotencyKey ?? null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning();
    if (!created) throw new Error("Gagal membuat job ekspor.");

    await audit.log(
      {
        action: "reporting.export.enqueue",
        entityType: "job_run",
        entityId: created.id,
        actorId: actor.userId,
        after: { reportKey: entry.key, fileName: created.fileName, runAt: isoDay(runAt), docNo },
      },
      tx,
    );
    return summarize(created);
  });
}

/**
 * Antrekan kalkulasi run payroll (Tahap 8E). Pemanggil wajib memegang
 * `payroll.runs.manage`; run itu sendiri divalidasi handler saat job jalan
 * (status draft/calculated, periode belum tertutup). `idempotencyKey` default
 * diturunkan dari runId supaya create run tidak menumpuk job kalkulasi ganda.
 */
export async function enqueuePayrollRun(
  actor: AuthContext,
  input: EnqueuePayrollRunInput,
  externalTx?: Tx,
) {
  assertCan(actor, "payroll.runs.manage");

  const payload: PayrollRunPayload = { runId: input.runId };
  const idempotencyKey = input.idempotencyKey ?? `payroll.run:${input.runId}`;

  return inTx(externalTx, async (tx) => {
    const [existing] = await tx
      .select()
      .from(jobRuns)
      .where(and(eq(jobRuns.idempotencyKey, idempotencyKey), ne(jobRuns.status, "cancelled")))
      .limit(1);
    if (existing) return summarize(existing);

    const runAt = input.runAt ? new Date(`${input.runAt}T00:00:00Z`) : new Date();

    const [created] = await tx
      .insert(jobRuns)
      .values({
        type: "payroll.run",
        status: "queued",
        payload,
        runAt,
        maxAttempts: input.maxAttempts ?? 3,
        idempotencyKey,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning();
    if (!created) throw new Error("Gagal membuat job kalkulasi payroll.");

    await audit.log(
      {
        action: "payroll.run.enqueue",
        entityType: "job_run",
        entityId: created.id,
        actorId: actor.userId,
        after: { runId: input.runId, runAt: isoDay(runAt) },
      },
      tx,
    );
    return summarize(created);
  });
}

/* ------------------------------- Baca ------------------------------- */

/**
 * Tuple cursor untuk keyset paginasi job: (createdAt, id) terbaru-duluan.
 * Format ISO-8601 dengan presisi millisecond — stabil terhadap timezone
 * karena Postgres mengembalikan timestamptz sebagai Date (UTC).
 */
const jobsCursorSchema = z.object({
  t: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
  i: z.uuid(),
});

function jobsCursorTuple(row: { createdAt: Date; id: string }): { t: string; i: string } {
  return { t: row.createdAt.toISOString(), i: row.id };
}

/**
 * Daftar job latar belakang (Tahap 10C: keyset opaque cursor).
 * Filter: status, type, createdBy (di-faksakan ke actor.userId kecuali memegang manage).
 * Tidak ada total count (menghindari full-table scan); klien memakai `hasMore`.
 */
export async function listJobs(actor: AuthContext, query: ListJobsQuery, externalTx?: Tx) {
  assertCan(actor, "reporting.exports.read");
  const reader = externalTx ?? db;

  // Tahap 10B (IDOR): tanpa `exports.manage`, daftar difaksakan ke job milik sendiri;
  // filter lintas-pengguna dari query diabaikan. Admin tetap boleh memfilter bebas.
  const isManager = can(actor.grants, "reporting.exports.manage");
  const ownerFilter = isManager
    ? query.createdBy
      ? eq(jobRuns.createdBy, query.createdBy)
      : undefined
    : eq(jobRuns.createdBy, actor.userId);

  const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor, jobsCursorSchema);
  const keysetCondition =
    cursor === undefined
      ? undefined
      : sql`(${jobRuns.createdAt}, ${jobRuns.id}) < (${cursor.t}::timestamptz, ${cursor.i}::uuid)`;

  const rows = await reader
    .select(listColumns)
    .from(jobRuns)
    .where(
      and(
        query.status ? eq(jobRuns.status, query.status) : undefined,
        query.type ? eq(jobRuns.type, query.type) : undefined,
        ownerFilter,
        keysetCondition,
      ),
    )
    .orderBy(desc(jobRuns.createdAt), desc(jobRuns.id))
    // Ambil limit + 1 untuk mendeteksi `hasMore` tanpa COUNT(*) kedua.
    .limit(query.limit + 1);

  const page = keysetPage(rows, query.limit, (r) => jobsCursorTuple({ createdAt: r.createdAt, id: r.id }));
  return { items: page.items, nextCursor: page.nextCursor, hasMore: page.hasMore };
}

export async function getJob(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "reporting.exports.read");
  const reader = externalTx ?? db;
  return summarize(await requireJobForActor(reader, actor, id));
}

/** Unduh artefak CSV. Hanya tersedia bila job selesai dan barisnya menyimpan artefak. */
export async function getJobArtifact(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "reporting.exports.read");
  const reader = externalTx ?? db;
  const job = await requireJobForActor(reader, actor, id);
  if (!job.artifactText || !job.contentType || !job.fileName) {
    throw businessRule("Artefak ekspor belum tersedia untuk job ini.");
  }
  return {
    fileName: job.fileName,
    contentType: job.contentType,
    text: job.artifactText,
  };
}

/* ------------------------------- Ubah ------------------------------- */

/** Batalkan job yang masih antre. Job berjalan/sudah selesai tidak boleh diutak-atik. */
export async function cancelJob(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "reporting.exports.manage");

  return inTx(externalTx, async (tx) => {
    const job = await lockJob(tx, id);
    if (job.status !== "queued") {
      throw businessRule(`Hanya job berstatus antre yang dapat dibatalkan (status: ${job.status}).`);
    }

    const [updated] = await tx
      .update(jobRuns)
      .set({ status: "cancelled", updatedBy: actor.userId, finishedAt: new Date() })
      .where(eq(jobRuns.id, id))
      .returning();
    if (!updated) throw notFound("Job tidak ditemukan.");

    await audit.log(
      {
        action: "reporting.export.cancel",
        entityType: "job_run",
        entityId: id,
        actorId: actor.userId,
        before: { status: job.status },
        after: { status: "cancelled" },
      },
      tx,
    );
    return summarize(updated);
  });
}

/* ---------------------------- Eksekusi job --------------------------- */

/**
 * Klaim satu job antre terlama yang sudah jatuh tempo di antara `types`.
 * Subquery `FOR UPDATE SKIP LOCKED` membuat banyak worker aman berjalan
 * paralel: worker lain melewati baris yang sedang dikunci, tidak ada dobel
 * proses. `types` menyaring pekerjaan yang boleh diklaim pemroses ini.
 */
async function claimNextJob(tx: Tx, userId: string, types: JobType[]): Promise<JobRun | null> {
  const typeFilter = sql.join(
    types.map((t) => sql`${t}::job_type`),
    sql`, `,
  );
  const claimed = await tx
    .update(jobRuns)
    .set({
      status: "running",
      attempts: sql`${jobRuns.attempts} + 1`,
      claimedAt: new Date(),
      updatedBy: userId,
    })
    .where(
      sql`${jobRuns.id} = (
        select ${jobRuns.id}
        from ${jobRuns}
        where ${jobRuns.status} = 'queued' and ${jobRuns.runAt} <= clock_timestamp()
          and ${jobRuns.type} in (${typeFilter})
        order by ${jobRuns.runAt}, ${jobRuns.id}
        for update skip locked
        limit 1
      )`,
    )
    .returning();

  return claimed[0] ?? null;
}

async function markSucceeded(tx: Tx, job: JobRun, outcome: JobOutcome, userId: string) {
  const [updated] = await tx
    .update(jobRuns)
    .set({
      status: "succeeded",
      result: { ...outcome.result, fileName: job.fileName },
      artifactText: outcome.artifactText ?? null,
      // Constraint `job_runs_artifact_chk`: artefak & contentType selalu sepasang.
      contentType: outcome.artifactText ? (outcome.contentType ?? null) : null,
      lastError: null,
      finishedAt: new Date(),
      updatedBy: userId,
    })
    .where(eq(jobRuns.id, job.id))
    .returning();
  if (!updated) throw notFound("Job tidak ditemukan.");
  return updated;
}

/**
 * Tandai kegagalan. Selama percobaan belum habis, job dikembalikan ke antrean
 * dengan `runAt` mundur eksponensial (backoff); sesudah itu jadi dead-letter
 * `failed` dan pesan error terakhir tersimpan untuk diagnosis.
 */
async function markFailed(tx: Tx, job: JobRun, error: string, userId: string) {
  const willRetry = job.attempts < job.maxAttempts;
  const now = new Date();

  const [updated] = await tx
    .update(jobRuns)
    .set({
      status: willRetry ? "queued" : "failed",
      lastError: error,
      runAt: willRetry ? new Date(now.getTime() + BACKOFF_BASE_MS * 2 ** (job.attempts - 1)) : job.runAt,
      claimedAt: willRetry ? null : job.claimedAt,
      finishedAt: willRetry ? null : now,
      updatedBy: userId,
    })
    .where(eq(jobRuns.id, job.id))
    .returning();
  if (!updated) throw notFound("Job tidak ditemukan.");
  return updated;
}

/**
 * Klaim lalu jalankan satu job (dipakai rute uji/operator dan loop worker 8E).
 * `executor` hanya boleh mengklaim jenis job yang izin eksekusinya dia pegang
 * (lihat `JOB_EXECUTOR_PERMISSION`); tanpa satu pun izin itu, klaim ditolak
 * lebih awal. Handler tiap jenis tetap memeriksa izin datanya sendiri, sehingga
 * job hanya jalan untuk pemroses yang punya hak atas data tersebut.
 *
 * Satu transaksi: kegagalan level aplikasi (validasi/bisnis) tertangkap dan
 * dicatat sebagai retry, sedangkan kegagalan level database membatalkan
 * transaksi — job tetap antre dan dicoba lagi.
 */
export async function runNextJob(executor: AuthContext, externalTx?: Tx) {
  const allowedTypes = (Object.keys(JOB_EXECUTOR_PERMISSION) as JobType[]).filter((type) =>
    can(executor.grants, JOB_EXECUTOR_PERMISSION[type]),
  );
  if (allowedTypes.length === 0) throw forbidden();

  return inTx(externalTx, async (tx) => {
    const job = await claimNextJob(tx, executor.userId, allowedTypes);
    if (!job) return null;

    const handler = JOB_HANDLERS[job.type];
    try {
      const outcome = await handler(tx, executor, job);
      return summarize(await markSucceeded(tx, job, outcome, executor.userId));
    } catch (error) {
      return summarize(await markFailed(tx, job, describeError(error), executor.userId));
    }
  });
}
