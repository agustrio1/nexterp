import { env } from "@/config/env";
import { getRequestContext } from "@/server/request-context";

/**
 * Logger terstruktur JSON-per-line untuk runtime Node (route handler / service).
 *
 * Kenapa bukan `console.log`:
 * - Vercel/Neon log ingestor mencari field tetap (`level`, `msg`, `time`,
 *   `requestId`) — dengan string template biasa operator harus regex ulang.
 * - Korelasi antar-log dalam satu request: requestId otomatis di-merge dari
 *   AsyncLocalStorage, jadi caller tidak perlu meneruskan id ke setiap pemanggilan.
 * - Level filter (LOG_LEVEL env) menyaring verbose debug di produksi tanpa
 *   harus hapus kode.
 *
 * Aturan penulisan: `msg` HARUS string literal stabil (tanpa interpolasi);
 * data dinamis masuk ke `fields`. Contoh benar:
 *   logger.info("cash transaction posted", { id, docNo, amount });
 * Contoh SALAH:
 *   logger.info(`posted ${id}`);
 *
 * Keamanan: `fields` di-serialisasi JSON; caller DILARANG menaruh PII/secret
 * langsung (password/token/api_key) — gunakan field teknis non-sensitif dan
 * rely on redact.ts untuk payload yang lebih kaya.
 */
type Level = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function minRank(): number {
  const raw = (env as { LOG_LEVEL?: Level }).LOG_LEVEL ?? "info";
  return LEVEL_RANK[raw] ?? LEVEL_RANK.info;
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (LEVEL_RANK[level] < minRank()) return;
  const ctx = getRequestContext();
  const line: Record<string, unknown> = {
    level,
    time: new Date().toISOString(),
    msg,
  };
  if (ctx) {
    line.requestId = ctx.requestId;
    if (ctx.method) line.method = ctx.method;
    if (ctx.path) line.path = ctx.path;
    if (ctx.userId) line.userId = ctx.userId;
  }
  if (fields) Object.assign(line, fields);
  const out = `${JSON.stringify(line)}\n`;
  // error -> stderr; sisanya -> stdout. Pemisahan ini membantu log shipper
  // memfilter level tanpa harus parse JSON.
  if (level === "error") process.stderr.write(out);
  else process.stdout.write(out);
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
};

/** Ekstrak field aman dari Error (message + stack, tanpa properti arbitrer). */
export function errorFields(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
    };
  }
  return { errorValue: String(error) };
}
