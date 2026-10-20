import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Laporan payroll (Tahap 7F) — sisi baca murni                        */
/* ------------------------------------------------------------------ */
// Semua nominal string desimal 2 dp. Sumber subledger: run berstatus posted
// (run reversed dikecualikan — jurnal aslinya sudah dinetokan oleh reversal).
// Sumber GL: baris jurnal posted+reversed pada akun payroll di companySettings.

const uuidSchema = z.uuid("Format ID tidak valid.");

/** Beban gaji per departemen/cabang dari run posted. Filter opsional. */
export const payrollCostByDepartmentQuerySchema = z.strictObject({
  periodId: uuidSchema.optional(),
  branchId: uuidSchema.optional(),
});

/** Daftar slip gaji per run/karyawan. */
export const payslipRegisterQuerySchema = z.strictObject({
  runId: uuidSchema.optional(),
  employeeId: uuidSchema.optional(),
});

/** Rekonsiliasi subledger↔GL payroll (posisi kini). Tanpa parameter. */
export const payrollReconciliationQuerySchema = z.strictObject({});

export type PayrollCostByDepartmentQuery = z.output<typeof payrollCostByDepartmentQuerySchema>;
export type PayslipRegisterQuery = z.output<typeof payslipRegisterQuerySchema>;
export type PayrollReconciliationQuery = z.output<typeof payrollReconciliationQuerySchema>;
