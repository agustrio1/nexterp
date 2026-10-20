import type { JobRun } from "@/db/schema";
import type { AuthContext } from "@/server/authz";
import type { Tx } from "@/modules/jobs/_refs";

import { findExportEntry } from "@/modules/reporting/export-catalog";
import { CSV_CONTENT_TYPE, toCsv } from "@/modules/reporting/csv";
import { exportPayloadSchema } from "@/modules/jobs/schemas";
import { businessRule } from "@/server/errors";

/* ------------------------------------------------------------------ */
/* Handler job. Satu file per `job_type`; registrinya di ./index.ts.    */
/* ------------------------------------------------------------------ */

/** Hasil kerja satu job: artefak (opsional) + ringkasan untuk `result`. */
export type JobOutcome = {
  artifactText?: string;
  contentType?: string;
  result: Record<string, unknown>;
};

export type JobHandler = (tx: Tx, actor: AuthContext, job: JobRun) => Promise<JobOutcome>;

/**
 * Ekspor laporan -> CSV. Query dalam payload sudah divalidasi saat enqueue,
 * jadi di sini hanya kunci laporan yang diperiksa ulang (fail-closed: job
 * yang dibuat sebelum sebuah laporan dihapus dari katalog tidak bisa jalan).
 * Izin laporan sumber ditegakkan oleh loader laporan itu sendiri terhadap
 * `actor` pemroses job — tanpa izin, job gagal dengan alasan tersimpan.
 */
export const runExportReport: JobHandler = async (tx, actor, job) => {
  const payload = exportPayloadSchema.parse(job.payload);
  const entry = findExportEntry(payload.reportKey);
  if (!entry) {
    throw businessRule(`Laporan ekspor "${payload.reportKey}" tidak lagi tersedia.`);
  }

  const { rows } = await entry.build(actor, payload.query, tx);
  return {
    artifactText: toCsv(rows),
    contentType: CSV_CONTENT_TYPE,
    result: {
      reportKey: entry.key,
      label: entry.label,
      rowCount: rows.length,
      generatedAt: new Date().toISOString(),
    },
  };
};
