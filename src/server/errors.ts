import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { env } from "@/config/env";
import { db } from "@/server/db";
import {
  apiBucket,
  apiGroupFromPath,
  appOriginFrom,
  clientIpFrom,
  isUnsafeMethod,
  sameOriginViolation,
} from "@/server/csrf";
import { API_UNSAFE_LIMIT_PER_MINUTE, enforceRateLimit } from "@/server/rate-limit";

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "CONFLICT"
  | "BUSINESS_RULE"
  | "RATE_LIMITED"
  | "INTERNAL";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  CONFLICT: 409,
  BUSINESS_RULE: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export type ErrorDetail = { path: string; message: string };

/**
 * Error yang aman ditampilkan ke klien. Pesan dan details dikirim apa adanya,
 * jadi jangan memasukkan data sensitif atau detail internal ke dalamnya.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: ErrorDetail[];

  constructor(code: ErrorCode, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

export const unauthenticated = (message = "Anda belum masuk atau sesi telah berakhir.") =>
  new AppError("UNAUTHENTICATED", message);

export const forbidden = (message = "Anda tidak memiliki izin untuk tindakan ini.") =>
  new AppError("FORBIDDEN", message);

export const notFound = (message = "Data tidak ditemukan.") => new AppError("NOT_FOUND", message);

export const conflict = (message: string) => new AppError("CONFLICT", message);

/** Pelanggaran aturan bisnis (mis. periode sudah ditutup, jurnal tidak seimbang). */
export const businessRule = (message: string) => new AppError("BUSINESS_RULE", message);

export const validationFailed = (details: ErrorDetail[], message = "Input tidak valid.") =>
  new AppError("VALIDATION_FAILED", message, details);

export const rateLimited = (message = "Terlalu banyak permintaan. Coba lagi nanti.") =>
  new AppError("RATE_LIMITED", message);

function fromZodError(error: ZodError): AppError {
  return validationFailed(
    error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    })),
  );
}

/** Kode SQLSTATE dibaca dari error driver, termasuk yang dibungkus Drizzle di `cause`. */
function sqlState(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth++) {
    if ("code" in current && typeof current.code === "string" && current.code.length === 5) {
      return current.code;
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
}

/** Mengubah error apa pun menjadi AppError. Error tak dikenal menjadi INTERNAL tanpa detail. */
export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) return fromZodError(error);

  switch (sqlState(error)) {
    case "23505":
      return conflict("Data dengan nilai yang sama sudah ada.");
    case "23503":
      return conflict("Data masih terhubung dengan data lain atau rujukannya tidak ada.");
    default:
      return new AppError("INTERNAL", "Terjadi kesalahan pada server.");
  }
}

/** Bentuk respons error baku: { error: { code, message, details?, requestId } } */
export function toErrorResponse(error: unknown, requestId: string = crypto.randomUUID()): NextResponse {
  const appError = normalizeError(error);

  if (appError.code === "INTERNAL") {
    // Detail asli hanya masuk log server, tidak pernah ke klien.
    console.error(`[error] requestId=${requestId}`, error);
  }

  return NextResponse.json(
    {
      error: {
        code: appError.code,
        message: appError.message,
        ...(appError.details ? { details: appError.details } : {}),
        requestId,
      },
    },
    { status: appError.status, headers: { "x-request-id": requestId } },
  );
}

/**
 * Pembungkus Route Handler: error yang dilempar di dalam handler otomatis
 * menjadi respons error baku. Contoh:
 *   export const GET = apiHandler(async (req) => NextResponse.json({ ok: true }));
 *
 * Error internal Next.js (bailout dinamis saat prerender, redirect, notFound bawaan Next)
 * dilempar ulang, bukan dipetakan menjadi respons error.
 *
 * Guard keamanan (Tahap 10B), khusus metode tidak aman (POST/PUT/PATCH/DELETE)
 * dan hanya bila argumen pertama adalah `Request`:
 *  1) CSRF same-origin — tolak bila Origin/Referer hadir dan beda-origin.
 *  2) Rate-limit DB — bucket "api:<grup>:<ip>", default 120/menit.
 * Handler telanjang (mis. `/api/health`) tidak melalui jalur ini dan otomatis lolos.
 */
export function apiHandler<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      const first = args[0];
      if (first instanceof Request && isUnsafeMethod(first.method)) {
        const violation = sameOriginViolation(first.headers, appOriginFrom(env.APP_URL));
        if (violation) {
          // Alasan hanya masuk log server (berisi origin klien); klien dapat pesan umum.
          console.warn(`[csrf] ditolak method=${first.method} ${violation}`);
          throw forbidden("Asal permintaan tidak dikenali.");
        }
        const group = apiGroupFromPath(new URL(first.url).pathname);
        const ip = clientIpFrom(first.headers);
        await enforceRateLimit(db, apiBucket(group, ip), API_UNSAFE_LIMIT_PER_MINUTE);
      }
      return await handler(...args);
    } catch (error) {
      unstable_rethrow(error);
      return toErrorResponse(error);
    }
  };
}