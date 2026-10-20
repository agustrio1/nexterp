import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Query dashboard (Tahap 8D). Semua filter opsional: service           */
/* menurunkan rentang sendiri (periodId -> tanggal periode; from/to ->  */
/* dipakai apa adanya; kosong -> bulan berjalan UTC).                   */
/* Konvensi periode sama dengan laporan keuangan 4E: periodId tidak     */
/* boleh digabung dengan from/to.                                       */
/* ------------------------------------------------------------------ */

const dateSchema = z.iso.date("Tanggal harus berformat YYYY-MM-DD.");
const uuidSchema = z.uuid("Format ID tidak valid.");

export const dashboardQuerySchema = z
  .strictObject({
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    periodId: uuidSchema.optional(),
    branchId: uuidSchema.optional(),
  })
  .refine(
    (value) => !value.periodId || (!value.from && !value.to),
    { message: "periodId tidak boleh digabung dengan from/to." },
  )
  .refine((value) => !value.from || !value.to || value.to >= value.from, {
    path: ["to"],
    message: "to tidak boleh sebelum from.",
  });

export type DashboardQuery = z.output<typeof dashboardQuerySchema>;
