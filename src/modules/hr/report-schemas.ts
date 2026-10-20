import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Laporan HR (Tahap 7F) — sisi baca murni, read-only                  */
/* ------------------------------------------------------------------ */
// Headcount, rekap absensi, dan saldo cuti. Tidak menyentuh data remunerasi
// (`payroll.*`) — cukup izin `hr.reports.read`.

const dateSchema = z.iso.date("Tanggal harus berformat YYYY-MM-DD.");
const uuidSchema = z.uuid("Format ID tidak valid.");

/** Jumlah karyawan aktif per departemen (filter cabang opsional). */
export const headcountQuerySchema = z.strictObject({
  branchId: uuidSchema.optional(),
});

/** Rekap absensi dalam rentang tanggal; filter departemen/cabang opsional. */
export const attendanceSummaryQuerySchema = z
  .strictObject({
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    departmentId: uuidSchema.optional(),
    branchId: uuidSchema.optional(),
  })
  .refine((v) => !v.from || !v.to || v.to >= v.from, {
    path: ["to"],
    message: "to tidak boleh sebelum from.",
  });

/** Saldo cuti per karyawan/jenis untuk suatu tahun (default tahun berjalan). */
export const leaveBalancesQuerySchema = z.strictObject({
  year: z.coerce.number().int().min(1900).max(9999).optional(),
  departmentId: uuidSchema.optional(),
});

export type HeadcountQuery = z.output<typeof headcountQuerySchema>;
export type AttendanceSummaryQuery = z.output<typeof attendanceSummaryQuerySchema>;
export type LeaveBalancesQuery = z.output<typeof leaveBalancesQuerySchema>;
