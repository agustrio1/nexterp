import { calculateRun } from "@/modules/payroll/run-service";
import { payrollRunPayloadSchema } from "@/modules/jobs/schemas";

import type { JobHandler } from "./export-report";

/* ------------------------------------------------------------------ */
/* Handler job kalkulasi payroll (Tahap 8E).                          */
/* Kalkulasi massal berat dipindah dari jalur API ke antrean: rute    */
/* create run enqueue job ini, worker mengeksekusi calculateRun.      */
/* calculateRun tetap memeriksa izin `payroll.runs.manage` terhadap   */
/* `actor` pemroses dan status run — sehingga job hanya jalan untuk    */
/* operator berhak pada run yang masih draft/calculated.              */
/* ------------------------------------------------------------------ */

export const runPayrollRun: JobHandler = async (tx, actor, job) => {
  const payload = payrollRunPayloadSchema.parse(job.payload);
  // `tx` job dan `tx` payroll adalah tipe transaksi db yang sama (struktural).
  const run = await calculateRun(actor, payload.runId, tx);
  return {
    result: {
      runId: run.id,
      status: run.status,
      employeeCount: run.employeeCount,
      totalEarnings: run.totalEarnings,
      totalDeductions: run.totalDeductions,
      totalNet: run.totalNet,
    },
  };
};
