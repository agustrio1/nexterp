import { env } from "@/config/env";
import { businessRule } from "@/server/errors";

import { fakeProvider } from "./providers/fake";
import { geminiProvider } from "./providers/gemini";

/* ------------------------------------------------------------------ */
/* Abstraksi provider AI (Tahap 9B).                                   */
/* Semua panggilan AI lewat server. Interface kecil & murni supaya    */
/* layanan inti tidak tahu ada tidaknya provider, dan tes bisa         */
/* menginjeksi provider fake deterministik tanpa jaringan.             */
/* ------------------------------------------------------------------ */

export type AiRequest = {
  /** Instruksi sistem (peran + aturan), dipisah dari prompt pengguna. */
  system?: string;
  prompt: string;
  /** Minta keluaran JSON ketat (Gemini responseMimeType=application/json). */
  json?: boolean;
  temperature?: number;
  /** Override batas token output; bila kosong pakai nilai konfigurasi. */
  maxOutputTokens?: number;
};

export type AiResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
};

/** Klasifikasi galat provider; `transient` aman untuk retry terbatas. */
export type AiErrorKind = "config" | "bad_request" | "upstream_rate_limit" | "transient" | "timeout";

export class AiError extends Error {
  readonly kind: AiErrorKind;

  constructor(kind: AiErrorKind, message: string) {
    super(message);
    this.name = "AiError";
    this.kind = kind;
  }
}

export interface AiProvider {
  readonly name: string;
  generate(request: AiRequest): Promise<AiResult>;
}

export type ResolvedAiSettings = {
  provider: "gemini" | "fake" | "none";
  model: string | null;
  maxOutputTokens: number;
};

/**
 * Bangun provider dari konfigurasi. Kill-switch (`enabled`) dicek pemanggil
 * sebelum ini; di sini hanya validasi kesiapan provider:
 * - `fake` : selalu tersedia, tanpa kunci (dipakai tes & mode offline).
 * - `gemini`: butuh GEMINI_API_KEY + model terisi, jika tidak -> config error.
 * - `none`  : AI dimatikan -> businessRule (ERP inti tetap jalan).
 */
export function resolveProvider(settings: ResolvedAiSettings): AiProvider {
  switch (settings.provider) {
    case "fake":
      return fakeProvider;
    case "gemini": {
      const apiKey = env.GEMINI_API_KEY;
      if (!apiKey) throw businessRule("Provider Gemini dipilih tetapi GEMINI_API_KEY belum diset.");
      if (!settings.model) throw businessRule("Provider Gemini dipilih tetapi model belum dikonfigurasi.");
      return geminiProvider({ apiKey, model: settings.model, maxOutputTokens: settings.maxOutputTokens });
    }
    case "none":
      throw businessRule("AI dimatikan (provider none).");
  }
}
