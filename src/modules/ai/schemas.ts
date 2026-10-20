import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Skema modul AI (Tahap 9B-9C).                                      */
/* Nilai enum provider/ status ditulis ulang sebagai literal karena     */
/* `z.enum` butuh tuple string; sama persis dengan skema di             */
/* src/db/schema/ai.ts (sumber kebenaran).                              */
/* ------------------------------------------------------------------ */

export const AI_PROVIDERS = ["gemini", "fake", "none"] as const;
export const AI_REQUEST_STATUSES = [
  "ok",
  "error",
  "rate_limited",
  "disabled",
  "unauthorized",
  "validation",
] as const;
export type AiRequestStatus = (typeof AI_REQUEST_STATUSES)[number];

/** Plafon keras panjang pertanyaan (batas dinamis per konfigurasi dicek di service). */
const QUESTION_CEILING = 8000;

/** Body PUT /api/ai/settings — ubah sebagian; minimal satu kunci hadir. */
export const updateAiSettingsSchema = z
  .strictObject({
    provider: z.enum(AI_PROVIDERS).optional(),
    /** null = kosongkan model (mis. saat pindah ke provider fake/none). */
    model: z.string().min(1).max(120).nullable().optional(),
    enabled: z.boolean().optional(),
    maxInputChars: z.coerce.number().int().min(1).max(20000).optional(),
    maxOutputTokens: z.coerce.number().int().min(1).max(8000).optional(),
    rateLimitPerMinute: z.coerce.number().int().min(0).max(10000).optional(),
    dailyRequestLimit: z.coerce.number().int().min(0).max(1_000_000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Tidak ada perubahan yang dikirim.",
  });

export type UpdateAiSettingsInput = z.output<typeof updateAiSettingsSchema>;

/**
 * Body POST /api/ai/assistant/report-query. `filters` hanyalah pelengkap opsional;
 * parameter laporan yang sebenarnya dihasilkan dari intent (divalidasi skema laporan sumber).
 */
export const askReportQuerySchema = z.strictObject({
  question: z.string().trim().min(3, "Pertanyaan terlalu pendek.").max(QUESTION_CEILING),
  filters: z.record(z.string(), z.unknown()).optional(),
});

export type AskReportQueryInput = z.output<typeof askReportQuerySchema>;

/** Bentuk JSON yang wajib dikembalikan provider pada langkah klasifikasi intent. */
export const intentResultSchema = z.strictObject({
  reportKey: z.string().min(1).max(64),
  query: z.record(z.string(), z.unknown()).default({}),
  rationale: z.string().max(500).optional(),
});

export type IntentResult = z.output<typeof intentResultSchema>;
