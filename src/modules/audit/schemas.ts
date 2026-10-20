import { z } from "zod";

const MAX_LIMIT = 200;

function isRealDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal harus berformat YYYY-MM-DD.")
  .refine(isRealDate, "Tanggal tidak valid.");

const filterText = z.string().trim().min(1, "Tidak boleh kosong.").max(100, "Maksimal 100 karakter.");

/** Query string selalu berupa teks, jadi limit dikonversi dari teks angka. */
const limitSchema = z
  .string()
  .regex(/^\d+$/, "limit harus berupa bilangan bulat.")
  .transform(Number)
  .pipe(
    z
      .number()
      .int()
      .min(1, "limit minimal 1.")
      .max(MAX_LIMIT, `limit maksimal ${MAX_LIMIT}.`),
  );

export const listAuditLogsQuerySchema = z
  .strictObject({
    action: filterText.optional(),
    /** Awalan aksi, contoh: "role." untuk role.create, role.update, role.delete. */
    actionPrefix: filterText.optional(),
    entityType: filterText.optional(),
    entityId: filterText.optional(),
    actorId: z.uuid("Format ID tidak valid.").optional(),
    dateFrom: dateSchema.optional(),
    dateTo: dateSchema.optional(),
    limit: limitSchema.optional(),
    cursor: z.string().min(1).max(500).optional(),
  })
  .refine((value) => !value.dateFrom || !value.dateTo || value.dateTo >= value.dateFrom, {
    path: ["dateTo"],
    message: "dateTo tidak boleh sebelum dateFrom.",
  });

export type ListAuditLogsQuery = z.output<typeof listAuditLogsQuerySchema>;