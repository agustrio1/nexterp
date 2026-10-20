import { z } from "zod";

import { isoDateSchema, uuidSchema } from "@/server/validation";

/* ------------------------------------------------------------------ */
/* Skema modul AI (Tahap 9B-9F).                                      */
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

/**
 * Body POST /api/ai/assistant/analyze (Tahap 9D). `analysisKey` opsional: bila kosong,
 * provider mengklasifikasi dari katalog analisis yang diizinkan. `params` hanyalah
 * calon parameter; nilai sebenarnya divalidasi skema tiap analisis (entry.parseParams).
 */
export const analyzeQuerySchema = z.strictObject({
  question: z.string().trim().min(3, "Pertanyaan terlalu pendek.").max(QUESTION_CEILING),
  analysisKey: z.string().min(1).max(64).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});

export type AnalyzeQueryInput = z.output<typeof analyzeQuerySchema>;

/** Bentuk JSON intent analisis (cermin intentResultSchema, kunci `analysisKey`). */
export const analysisIntentSchema = z.strictObject({
  analysisKey: z.string().min(1).max(64),
  params: z.record(z.string(), z.unknown()).default({}),
  rationale: z.string().max(500).optional(),
});

export type AnalysisIntent = z.output<typeof analysisIntentSchema>;

/**
 * Query GET /api/ai/usage (Tahap 9F). Semua opsional; `from`/`to` membatasi
 * rentang createdAt, `feature`/`userId` menyempitkan agregasi.
 */
export const usageQuerySchema = z
  .strictObject({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    feature: z.string().min(1).max(64).optional(),
    userId: uuidSchema.optional(),
  })
  .refine((v) => !v.from || !v.to || v.to >= v.from, { path: ["to"], message: "to tidak boleh sebelum from." });

export type UsageQueryInput = z.output<typeof usageQuerySchema>;
