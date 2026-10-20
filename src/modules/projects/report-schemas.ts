import { z } from "zod";

/* Query laporan proyek (Tahap 8C). Nilai tanggal & id sama polanya dengan
   query aset; profitabilitas default seluruh rentang & seluruh proyek. */

const idSchema = z.uuid("Format ID tidak valid.");
const dateSchema = z.iso.date("Tanggal harus berformat YYYY-MM-DD.");

export const profitabilityQuerySchema = z.object({
  projectId: idSchema.optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
});

export type ProfitabilityQuery = z.output<typeof profitabilityQuerySchema>;
