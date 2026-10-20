import { env } from "@/config/env";
import type { CsvRow } from "@/modules/reporting/csv";
import { EXPORT_ENTRIES, findExportEntry } from "@/modules/reporting/export-catalog";
import { requireActor } from "@/server/auth/actor";
import { can, type AuthContext } from "@/server/authz";
import { db } from "@/server/db";
import {
  AppError,
  businessRule,
  forbidden,
  normalizeError,
  rateLimited,
  validationFailed,
} from "@/server/errors";
import { parseWith } from "@/server/validation";
import { ZodError } from "zod";

import { findAnalysis, permittedAnalyses, type AnalysisEntry } from "./analytics";
import { assertCan, requireSettingsRow, type Reader, type Tx } from "./_refs";
import {
  ANALYZE_CLASSIFY_SYSTEM,
  ANALYZE_EXPLAIN_SYSTEM,
  buildAnalyzeClassifyPrompt,
  buildAnalyzeExplainPrompt,
  buildClassifyPrompt,
  buildSummarizePrompt,
  CLASSIFY_SYSTEM,
  SUMMARIZE_SYSTEM,
} from "./prompt";
import { buildSummaryData, redactAnalysis } from "./redact";
import { AiError, type AiProvider, type AiRequest, type AiResult, resolveProvider } from "./provider";
import { checkQuota } from "./quota";
import type {
  AiRequestStatus,
  AnalysisIntent,
  AnalyzeQueryInput,
  AskReportQueryInput,
  IntentResult,
} from "./schemas";
import { analysisIntentSchema, intentResultSchema } from "./schemas";
import { logAiRequest } from "./usage-log";

/* ------------------------------------------------------------------ */
/* Asisten "bahasa alami" (Tahap 9C laporan + 9D analisis).            */
/* Alur satu arah & deterministik, sesuai bagian 18 dokumen induk:       */
/*   intent -> validasi parameter -> cek otorisasi -> service deterministik */
/*   (sumber angka) -> narasi AI. Tidak ada SQL bebas; AI tidak          */
/*   menghitung. Provider bisa diinjeksi (tes memakai fake tanpa jaringan). */
/* ------------------------------------------------------------------ */

const FEATURE = "report.assistant";
const ANALYSIS_FEATURE = "analysis.assistant";

type SettingsRow = Awaited<ReturnType<typeof requireSettingsRow>>;

export type AskReportInput = AskReportQueryInput;

export type AssistantResult = {
  answer: string;
  report: { key: string; label: string; filter: unknown; source: "deterministic service" };
  data: unknown;
  meta: { model: string; inputTokens: number; outputTokens: number; durationMs: number };
  disclaimer: string;
};

export type AskAnalysisInput = AnalyzeQueryInput;

export type AnalysisResult = {
  answer: string;
  analysis: { key: string; label: string; params: unknown; source: "deterministic service" };
  metrics: Record<string, string | number>;
  series: CsvRow[];
  flags: CsvRow[];
  meta: { model: string; inputTokens: number; outputTokens: number; durationMs: number };
  disclaimer: string;
};

type AssistantOptions = { provider?: AiProvider; tx?: Tx };

/** Ambil objek JSON pertama dari teks provider (toleransi pagar ```json dan teks pengantar). */
function extractJsonObject(text: string): unknown {
  const cleaned = text.replace(/```/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Provider tidak mengembalikan JSON yang valid.");
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new Error("Provider mengembalikan JSON yang tidak dapat dibaca.");
  }
}

/** Satu panggilan provider + hitung latensi; AiError dipetakan ke AppError rapi. */
async function callProvider(provider: AiProvider, request: AiRequest, maxOutputTokens: number): Promise<AiResult> {
  try {
    return await provider.generate({ ...request, maxOutputTokens: request.maxOutputTokens ?? maxOutputTokens });
  } catch (error) {
    if (error instanceof AiError) {
      if (error.kind === "upstream_rate_limit") throw rateLimited(error.message);
      throw businessRule(`Layanan AI gagal (${error.kind}).`);
    }
    throw normalizeError(error);
  }
}

/**
 * Gerbang bersama 9C & 9D — dijalankan SEBELUM panggilan provider apa pun.
 * Urutan tetap: kill-switch -> batas panjang -> kuota -> bangun provider.
 * Masing-masing penolakan dicatat ke `ai_requests` (status disabled/validation/
 * rate_limited) dan Melempar AppError; ERP inti tidak tersentuh.
 *
 * Saklar fungsional = ai_settings.enabled (selalu ditegakkan). Provider "none" = mati.
 * AI_ENABLED (env) adalah guard egress GLOBAL: hanya wajib saat provider nyata (gemini)
 * dipakai — karena justru di situ data keluar ke Google. Provider fake/injected (offline,
 * tanpa jaringan/ongkos) tidak memerlukan AI_ENABLED, cukup saklar tenant.
 */
async function guardedPreflight(args: {
  actor: AuthContext;
  feature: string;
  reader: Reader;
  settings: SettingsRow;
  question: string;
  providerOverride?: AiProvider;
}): Promise<AiProvider> {
  const { actor, feature, reader, settings, question } = args;
  const providerName = settings.provider;
  const egressAllowed = providerName !== "gemini" || env.AI_ENABLED;

  if (!settings.enabled || providerName === "none" || !egressAllowed) {
    await logAiRequest({ userId: actor.userId, feature, provider: providerName, status: "disabled" }, reader);
    throw businessRule("Asisten AI sedang dimatikan.");
  }

  // Batas panjang input dinamis (di samping plafon statis skema).
  if (question.length > settings.maxInputChars) {
    await logAiRequest({ userId: actor.userId, feature, provider: providerName, status: "validation" }, reader);
    throw validationFailed([
      { path: "question", message: `Pertanyaan melebihi batas ${settings.maxInputChars} karakter.` },
    ]);
  }

  try {
    await checkQuota(reader, actor.userId, settings, new Date());
  } catch (error) {
    await logAiRequest({ userId: actor.userId, feature, provider: providerName, status: "rate_limited" }, reader);
    throw error;
  }

  return (
    args.providerOverride ??
    resolveProvider({
      provider: settings.provider,
      model: settings.model,
      maxOutputTokens: settings.maxOutputTokens,
    })
  );
}

export async function askReport(
  actor: AuthContext,
  input: AskReportInput,
  options: AssistantOptions = {},
): Promise<AssistantResult> {
  assertCan(actor, "ai.assistant.use");

  const reader = options.tx ?? db;
  const settings = await requireSettingsRow(reader);
  const providerName = settings.provider;
  const provider = await guardedPreflight({
    actor,
    feature: FEATURE,
    reader,
    settings,
    question: input.question,
    providerOverride: options.provider,
  });

  const startedAt = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;

  // Katalog yang DIIZINKAN saja — model tidak pernah melihat laporan di luar izin pengguna.
  const permitted = EXPORT_ENTRIES.filter((entry) => can(actor.grants, entry.permission));
  if (permitted.length === 0) {
    await logAiRequest({ userId: actor.userId, feature: FEATURE, provider: providerName, status: "unauthorized" }, reader);
    throw forbidden("Anda tidak punya izin laporan apa pun untuk ditanyakan.");
  }

  try {
    // 1) Intent + parameter (JSON ketat).
    const classify = await callProvider(
      provider,
      {
        system: CLASSIFY_SYSTEM,
        prompt: buildClassifyPrompt(input.question, permitted.map((e) => ({ key: e.key, label: e.label }))),
        json: true,
      },
      settings.maxOutputTokens,
    );
    inputTokens += classify.inputTokens;
    outputTokens += classify.outputTokens;

    const intent = parseWith(intentResultSchema, extractJsonObject(classify.text));

    // 2) Validasi + otorisasi ULANG di server (jangan pernah percaya model).
    const resolved = resolveIntent(actor, intent);

    // 3) Ambil angka NYATA dari service laporan (sumber kebenaran deterministik).
    const outcome = await resolved.entry.build(actor, resolved.query, options.tx);

    // 4) Ringkas data yang sudah diminimasi (bukan angka dari model).
    const summary = buildSummaryData({
      reportKey: resolved.entry.key,
      reportLabel: resolved.entry.label,
      filter: asRecord(resolved.query),
      rows: outcome.rows,
    });
    const described = await callProvider(
      provider,
      { system: SUMMARIZE_SYSTEM, prompt: buildSummarizePrompt(input.question, summary) },
      settings.maxOutputTokens,
    );
    inputTokens += described.inputTokens;
    outputTokens += described.outputTokens;

    const model = described.model || classify.model;
    await logAiRequest(
      {
        userId: actor.userId,
        feature: FEATURE,
        provider: providerName,
        model,
        status: "ok",
        reportKey: resolved.entry.key,
        filters: safeFilters(resolved.query),
        inputTokens,
        outputTokens,
        durationMs: Date.now() - startedAt,
      },
      reader,
    );

    return {
      answer: described.text,
      report: {
        key: resolved.entry.key,
        label: resolved.entry.label,
        filter: resolved.query,
        source: "deterministic service",
      },
      data: outcome.rows,
      meta: {
        model,
        inputTokens,
        outputTokens,
        durationMs: Date.now() - startedAt,
      },
      disclaimer: "Angka dihitung oleh service laporan; AI hanya meringkas dan bukan sumber kebenaran.",
    };
  } catch (error) {
    await logAiRequest({
      userId: actor.userId,
      feature: FEATURE,
      provider: providerName,
      status: statusForError(error),
      errorClass: error instanceof AiError ? error.kind : error instanceof Error ? error.name : "unknown",
      inputTokens,
      outputTokens,
      durationMs: Date.now() - startedAt,
    }, reader);
    throw error;
  }
}

/**
 * Asisten analisis 9D: intent -> validasi param -> otorisasi ULANG -> hitung
 * deterministik via service laporan (analytics.ts) -> AI menjelaskan. Angka selalu
 * dari service; provider fake/injected memungkinkan uji tanpa jaringan.
 */
export async function askAnalysis(
  actor: AuthContext,
  input: AskAnalysisInput,
  options: AssistantOptions = {},
): Promise<AnalysisResult> {
  assertCan(actor, "ai.assistant.use");

  const reader = options.tx ?? db;
  const settings = await requireSettingsRow(reader);
  const providerName = settings.provider;
  const provider = await guardedPreflight({
    actor,
    feature: ANALYSIS_FEATURE,
    reader,
    settings,
    question: input.question,
    providerOverride: options.provider,
  });

  const startedAt = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let firstModel = "";

  // Katalog analisis yang DIIZINKAN saja — model tidak pernah melihat yang lain.
  const permitted = permittedAnalyses(actor.grants);
  if (permitted.length === 0) {
    await logAiRequest({ userId: actor.userId, feature: ANALYSIS_FEATURE, provider: providerName, status: "unauthorized" }, reader);
    throw forbidden("Anda tidak punya izin untuk analisis apa pun.");
  }

  try {
    // 1) Intent analisis: dari input.analysisKey (jalan pintas) atau klasifikasi provider.
    let intent: AnalysisIntent;
    if (input.analysisKey) {
      intent = { analysisKey: input.analysisKey, params: input.params ?? {}, rationale: undefined };
    } else {
      const classify = await callProvider(
        provider,
        {
          system: ANALYZE_CLASSIFY_SYSTEM,
          prompt: buildAnalyzeClassifyPrompt(input.question, permitted.map((e) => ({ key: e.key, label: e.label }))),
          json: true,
        },
        settings.maxOutputTokens,
      );
      inputTokens += classify.inputTokens;
      outputTokens += classify.outputTokens;
      firstModel = classify.model;
      intent = parseWith(analysisIntentSchema, extractJsonObject(classify.text));
    }

    // 2) Validasi + otorisasi ULANG di server (jangan pernah percaya model).
    const resolved = resolveAnalysisIntent(actor, intent);

    // 3) Hitung angka NYATA lewat service deterministik (analytics.ts).
    const outcome = await resolved.entry.compute(actor, resolved.params, options.tx);

    // 4) Jelaskan angka yang sudah dihitung & diminimasi (bukan angka dari model).
    const summary = redactAnalysis(outcome);
    const explained = await callProvider(
      provider,
      { system: ANALYZE_EXPLAIN_SYSTEM, prompt: buildAnalyzeExplainPrompt(input.question, summary) },
      settings.maxOutputTokens,
    );
    inputTokens += explained.inputTokens;
    outputTokens += explained.outputTokens;

    const model = explained.model || firstModel;
    await logAiRequest(
      {
        userId: actor.userId,
        feature: ANALYSIS_FEATURE,
        provider: providerName,
        model,
        status: "ok",
        reportKey: resolved.entry.key,
        filters: safeFilters(resolved.params),
        inputTokens,
        outputTokens,
        durationMs: Date.now() - startedAt,
      },
      reader,
    );

    return {
      answer: explained.text,
      analysis: {
        key: resolved.entry.key,
        label: resolved.entry.label,
        params: resolved.params,
        source: "deterministic service",
      },
      metrics: outcome.metrics,
      series: outcome.series ?? [],
      flags: outcome.flags ?? [],
      meta: {
        model,
        inputTokens,
        outputTokens,
        durationMs: Date.now() - startedAt,
      },
      disclaimer: "Angka dihitung oleh service deterministik; AI hanya menjelaskan dan bukan sumber kebenaran.",
    };
  } catch (error) {
    await logAiRequest({
      userId: actor.userId,
      feature: ANALYSIS_FEATURE,
      provider: providerName,
      status: statusForError(error),
      errorClass: error instanceof AiError ? error.kind : error instanceof Error ? error.name : "unknown",
      inputTokens,
      outputTokens,
      durationMs: Date.now() - startedAt,
    }, reader);
    throw error;
  }
}

/** Klasifikasi status ai_requests dari error terminal (satu log per percobaan). */
function statusForError(error: unknown): AiRequestStatus {
  if (error instanceof AppError) {
    if (error.code === "FORBIDDEN") return "unauthorized";
    if (error.code === "VALIDATION_FAILED") return "validation";
    if (error.code === "RATE_LIMITED") return "rate_limited";
    return "error";
  }
  if (error instanceof ZodError) return "validation";
  return "error";
}

type ResolvedIntent = { entry: (typeof EXPORT_ENTRIES)[number]; query: unknown };

/**
 * Cocokkan reportKey intent dengan katalog: tak dikenal/none -> validation;
 * dikenal tapi tanpa izin -> forbidden. Query divalidasi dengan skema laporan sumber.
 * TIDAK menulis log di sini — logging dilakukan sekali di pemanggil.
 */
function resolveIntent(actor: AuthContext, intent: IntentResult): ResolvedIntent {
  if (intent.reportKey === "none") {
    throw validationFailed([{ path: "reportKey", message: "Tidak ada laporan yang cocok untuk pertanyaan ini." }]);
  }

  const entry = findExportEntry(intent.reportKey);
  if (!entry) {
    throw validationFailed([{ path: "reportKey", message: "Laporan yang dipilih tidak dikenal." }]);
  }
  if (!can(actor.grants, entry.permission)) {
    throw forbidden("Anda tidak punya izin untuk laporan tersebut.");
  }

  return { entry, query: entry.parseQuery(intent.query) };
}

type ResolvedAnalysis = { entry: AnalysisEntry; params: Record<string, unknown> };

/**
 * Cermin resolveIntent untuk katalog analisis. Param divalidasi skema tiap analisis
 * (entry.parseParams -> ZodError -> validation) SEBELUM compute. Tidak menulis log.
 */
function resolveAnalysisIntent(actor: AuthContext, intent: AnalysisIntent): ResolvedAnalysis {
  if (intent.analysisKey === "none") {
    throw validationFailed([{ path: "analysisKey", message: "Tidak ada analisis yang cocok untuk pertanyaan ini." }]);
  }

  const entry = findAnalysis(intent.analysisKey);
  if (!entry) {
    throw validationFailed([{ path: "analysisKey", message: "Analisis yang dipilih tidak dikenal." }]);
  }
  if (!can(actor.grants, entry.permission)) {
    throw forbidden("Anda tidak punya izin untuk analisis tersebut.");
  }

  return { entry, params: asRecord(entry.parseParams(intent.params)) };
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** Simpan hanya parameter skalir aman (string/number/boolean) untuk jejak ai_requests. */
function safeFilters(query: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(asRecord(query))) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") out[key] = value;
  }
  return out;
}

/** Varian route 9C: bangun actor dari sesi lalu jalankan askReport. */
export async function askReportFromSession(input: AskReportInput, options: AssistantOptions = {}) {
  const actor = await requireActor();
  return askReport(actor, input, options);
}

/** Varian route 9D: bangun actor dari sesi lalu jalankan askAnalysis. */
export async function askAnalysisFromSession(input: AskAnalysisInput, options: AssistantOptions = {}) {
  const actor = await requireActor();
  return askAnalysis(actor, input, options);
}
