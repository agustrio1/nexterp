import type { JobType } from "@/db/schema";

import { runExportReport, type JobHandler } from "./export-report";
import { runPayrollRun } from "./payroll-run";

/**
 * Registri handler per jenis job. `Record<JobType, JobHandler>` memaksa jenis
 * baru di skema disertai handler-nya (kompilasi gagal bila ada `job_type`
 * tanpa eksekutor) — tidak ada cabang mati.
 */
export const JOB_HANDLERS: Record<JobType, JobHandler> = {
  "export.report": runExportReport,
  "payroll.run": runPayrollRun,
};

export type { JobHandler, JobOutcome } from "./export-report";
