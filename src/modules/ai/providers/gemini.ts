import { AiError, type AiProvider, type AiRequest, type AiResult } from "../provider";

/* ------------------------------------------------------------------ */
/* Provider Gemini (Tahap 9B) — free tier, lewat REST (tanpa SDK baru). */
/* Keputusan data: free tier Google memakai konten untuk meningkatkan   */
/* produk, jadi pemanggil WAJIB sudah minimisasi data (lihat redact.ts). */
/* Retry aman & terbatas: cuman untuk galat transient/timeout (maks 2).  */
/* ------------------------------------------------------------------ */

type GeminiConfig = { apiKey: string; model: string; maxOutputTokens: number };

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 20_000;
const MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 500;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

function endpoint(model: string): string {
  return `${BASE_URL}/${encodeURIComponent(model)}:generateContent`;
}

/** Bangun body generateContent dari AiRequest (sistem dipisah, JSON ketat saat diminta). */
function buildBody(request: AiRequest, maxOutputTokens: number): string {
  const generationConfig: Record<string, unknown> = {
    temperature: request.temperature ?? 0.2,
    maxOutputTokens: request.maxOutputTokens ?? maxOutputTokens,
  };
  if (request.json) generationConfig.responseMimeType = "application/json";

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: request.prompt }] }],
    generationConfig,
  };
  if (request.system) body.systemInstruction = { parts: [{ text: request.system }] };
  return JSON.stringify(body);
}

/** Petakan status HTTP ke klasifikasi AiError; transient/timeout boleh di-retry. */
function errorFromStatus(status: number, payloadText: string): AiError {
  if (status === 429) return new AiError("upstream_rate_limit", "Kuota Gemini (project) habis; coba lagi nanti.");
  if (status === 400) return new AiError("bad_request", `Permintaan Gemini ditolak (400): ${payloadText.slice(0, 200)}`);
  if (status === 401 || status === 403) return new AiError("config", "Kunci Gemini tidak valid / akses ditolak.");
  if (status >= 500) return new AiError("transient", `Gemini sedang tidak tersedia (${status}).`);
  return new AiError("bad_request", `Respons Gemini tak terduga (${status}).`);
}

/** Ekstrak teks gabungan + pemakaian token dari respons generateContent. */
function parseResponse(json: unknown): AiResult {
  if (!isRecord(json)) throw new AiError("bad_request", "Respons Gemini bukan objek JSON.");

  const candidates = json.candidates;
  const first = Array.isArray(candidates) ? candidates[0] : undefined;
  if (!isRecord(first)) throw new AiError("bad_request", "Gemini tidak mengembalikan kandidat.");

  const parts = isRecord(first.content) ? first.content.parts : undefined;
  const text = Array.isArray(parts)
    ? parts.map((p) => (isRecord(p) && typeof p.text === "string" ? p.text : "")).join("")
    : "";
  if (!text) throw new AiError("bad_request", "Kandidat Gemini kosong (mungkin diblokir).");

  const usage = isRecord(json.usageMetadata) ? json.usageMetadata : {};
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const model = typeof json.modelVersion === "string" ? json.modelVersion : "";

  return {
    text,
    inputTokens: num(usage.promptTokenCount),
    outputTokens: num(usage.candidatesTokenCount),
    model,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function callOnce(config: GeminiConfig, request: AiRequest, signal: AbortSignal): Promise<AiResult> {
  const response = await fetch(endpoint(config.model), {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": config.apiKey },
    body: buildBody(request, config.maxOutputTokens),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw errorFromStatus(response.status, errorText);
  }
  return parseResponse(await response.json());
}

/** Sekali panggilan dengan timeout + retry terbatas untuk transient/timeout. */
async function generateOnce(config: GeminiConfig, request: AiRequest): Promise<AiResult> {
  let attempt = 0;
  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await callOnce(config, request, controller.signal);
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      const aiError = aborted ? new AiError("timeout", "Panggilan Gemini melebihi batas waktu.") : error;
      const retryable =
        aiError instanceof AiError && (aiError.kind === "transient" || aiError.kind === "timeout");
      if (!retryable || attempt >= MAX_RETRIES) {
        if (aiError instanceof AiError) throw aiError;
        throw new AiError("transient", "Galat jaringan saat menghubungi Gemini.");
      }
      attempt += 1;
      await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timer);
    }
  }
}

export function geminiProvider(config: GeminiConfig): AiProvider {
  return {
    name: "gemini",
    generate: (request) => generateOnce(config, request),
  };
}
