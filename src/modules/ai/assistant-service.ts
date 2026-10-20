import { env } from "@/config/env";
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

import { assertCan, requireSettingsRow, type Tx } from "./_refs";
import { buildClassifyPrompt, buildSummarizePrompt, CLASSIFY_SYSTEM, SUMMARIZE_SYSTEM } from "./prompt";
import { buildSummaryData } from "./redact";
import { AiError, type AiProvider, type AiRequest, type AiResult, resolveProvider } from "./provider";
import { checkQuota } from "./quota";
import type { AiRequestStatus, AskReportQueryInput, IntentResult } from "./schemas";
import { intentResultSchema } from "./schemas";
import { logAiRequest } from "./usage-log";

/* ------------------------------------------------------------------ */
/* Asisten "bahasa alami -> laporan" (Tahap 9C).                       */
/* Alur satu arah & deterministik, sesuai bagian 18 dokumen induk:      */
/*   intent -> validasi parameter -> cek otorisasi -> service laporan    */
/*   (sumber angka) -> ringkasan AI. Tidak ada SQL bebas; AI tidak       */
/*   menghitung. Provider bisa diinjeksi (tes memakai fake tanpa jaringan).* */
/* ------------------------------------------------------------------ */

const FEATURE = "report.assistant";

export type AskReportInput = AskReportQueryInput;

export type AssistantResult = {
  answer: string;
  report: { key: string; label: string; filter: unknown; source: "deterministic service" };
  data: unknown;
  meta: { model: string; inputTokens: number; outputTokens: number; durationMs: number };
  disclaimer: string;
};

type AskReportOptions = { provider?: AiProvider; tx?: Tx };

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

export async function askReport(
  actor: AuthContext,
  input: AskReportInput,
  options: AskReportOptions = {},
): Promise<AssistantResult> {
  assertCan(actor, "ai.assistant.use");

  const reader = options.tx ?? db;
  const settings = await requireSettingsRow(reader);
  const providerName = settings.provider;
  const startedAt = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;

  // Saklar fungsional = ai_settings.enabled (selalu ditegakkan). Provider "none" = mati.
  // AI_ENABLED (env) adalah guard egress GLOBAL: hanya wajib saat provider nyata (gemini)
  // dipakai — karena justru di situ data keluar ke Google. Provider fake/injected (offline,
  // tanpa jaringan/ongkos) tidak memerlukan AI_ENABLED, cukup saklar tenant.
  const egressAllowed = settings.provider !== "gemini" || env.AI_ENABLED;
  if (!settings.enabled || settings.provider === "none" || !egressAllowed) {
    await logAiRequest({ userId: actor.userId, feature: FEATURE, provider: providerName, status: "disabled" }, reader);
    throw businessRule("Asisten AI sedang dimatikan.");
  }

  // Batas panjang input dinamis (di samping plafon statis skema).
  if (input.question.length > settings.maxInputChars) {
    await logAiRequest({ userId: actor.userId, feature: FEATURE, provider: providerName, status: "validation" }, reader);
    throw validationFailed([
      { path: "question", message: `Pertanyaan melebihi batas ${settings.maxInputChars} karakter.` },
    ]);
  }

  try {
    await checkQuota(reader, actor.userId, settings, new Date());
  } catch (error) {
    await logAiRequest({ userId: actor.userId, feature: FEATURE, provider: providerName, status: "rate_limited" }, reader);
    throw error;
  }

  const provider = options.provider ?? resolveProvider({
    provider: settings.provider,
    model: settings.model,
    maxOutputTokens: settings.maxOutputTokens,
  });

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

    await logAiRequest(
      {
        userId: actor.userId,
        feature: FEATURE,
        provider: providerName,
        model: described.model || classify.model,
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
        model: described.model || classify.model,
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

/** Varian untuk route: bangun actor dari sesi lalu jalankan askReport. */
export async function askReportFromSession(input: AskReportInput, options: AskReportOptions = {}) {
  const actor = await requireActor();
  return askReport(actor, input, options);
}
