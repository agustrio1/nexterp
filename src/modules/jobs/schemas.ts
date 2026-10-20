import { z } from "zod";

import { paginationSchema } from "@/server/validation";

/* ------------------------------------------------------------------ */
/* Skema job latar belakang (Tahap 8D).                                */
/* Nilai enum ditulis ulang sebagai literal karena `z.enum` membutuhkan */
/* tuple string; tetap sama persis dengan `job_type`/`job_status` di    */
/* src/db/schema/jobs.ts (sumber kebenaran skema).                      */
/* ------------------------------------------------------------------ */

export const JOB_TYPES = ["export.report", "payroll.run"] as const;
export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;

const dateSchema = z.iso.date("Tanggal harus berformat YYYY-MM-DD.");
const uuidSchema = z.uuid("Format ID tidak valid.");

/** Isi `payload` jsonb job ekspor — divalidasi ulang saat job dijalankan. */
export const exportPayloadSchema = z.strictObject({
  reportKey: z.string().min(1).max(64),
  query: z.record(z.string(), z.unknown()),
});

export type ExportPayload = z.output<typeof exportPayloadSchema>;

/** Isi `payload` jsonb job kalkulasi payroll — runId tujuan kalkulasi. */
export const payrollRunPayloadSchema = z.strictObject({
  runId: uuidSchema,
});

export type PayrollRunPayload = z.output<typeof payrollRunPayloadSchema>;

/**
 * Body POST /api/reports/export. `query` diteruskan apa adanya ke skema laporan
 * sumber (divalidasi di enqueue, bukan ditafsirkan ulang di sini).
 */
export const enqueueExportSchema = z.strictObject({
  reportKey: z.string().min(1).max(64),
  query: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().min(1).max(120).optional(),
  /** Tunda eksekusi (default sekarang). Bentuk ISO date; jam 00:00 UTC. */
  runAt: dateSchema.optional(),
  maxAttempts: z.coerce.number().int().min(1).max(10).optional(),
});

export type EnqueueExportInput = z.output<typeof enqueueExportSchema>;

/**
 * Body POST enqueue kalkulasi payroll (dipanggil otomatis oleh rute create run,
 * atau manual untuk recomputasi). `idempotencyKey` meniadakan dobel antrean
 * untuk run yang sama selama job-nya belum cancelled.
 */
export const enqueuePayrollRunSchema = z.strictObject({
  runId: uuidSchema,
  idempotencyKey: z.string().min(1).max(120).optional(),
  runAt: dateSchema.optional(),
  maxAttempts: z.coerce.number().int().min(1).max(10).optional(),
});

export type EnqueuePayrollRunInput = z.output<typeof enqueuePayrollRunSchema>;

/** Query daftar job (paginasi standar + filter status/jenis). */
export const listJobsQuerySchema = paginationSchema.extend({
  status: z.enum(JOB_STATUSES).optional(),
  type: z.enum(JOB_TYPES).optional(),
  createdBy: uuidSchema.optional(),
});

export type ListJobsQuery = z.output<typeof listJobsQuerySchema>;
