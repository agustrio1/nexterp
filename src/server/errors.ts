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
import {
  annotateRequestContext,
  getRequestContext,
  runWithRequestContext,
  sanitizeRequestId,
  type RequestContext,
} from "@/server/request-context";
import { errorFields, logger } from "@/server/logger";
import { reportError } from "@/server/error-reporter";

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
export function toErrorResponse(error: unknown, requestId?: string): NextResponse {
  const ctx = getRequestContext();
  const rid = requestId ?? ctx?.requestId ?? sanitizeRequestId(null);
  const appError = normalizeError(error);

  if (appError.code === "INTERNAL") {
    // Detail asli hanya masuk log server, tidak pernah ke klien.
    logger.error("unhandled internal error", {
      requestId: rid,
      path: ctx?.path,
      method: ctx?.method,
      ...errorFields(error),
    });
    reportError(error, {
      requestId: rid,
      path: ctx?.path,
      method: ctx?.method,
      userId: ctx?.userId,
    });
  }

  return NextResponse.json(
    {
      error: {
        code: appError.code,
        message: appError.message,
        ...(appError.details ? { details: appError.details } : {}),
        requestId: rid,
      },
    },
    { status: appError.status, headers: { "x-request-id": rid } },
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
    // 1) Bangun RequestContext dari argumen pertama (Request) — tanpa itu tetap
    //    berjalan (handler telanjang mis. /api/health) dengan requestId baru.
    const first = args[0];
    const req = first instanceof Request ? first : undefined;
    const requestId = sanitizeRequestId(req?.headers.get("x-request-id") ?? null);
    const ctx: RequestContext = {
      requestId,
      method: req?.method?.toUpperCase(),
      path: req ? new URL(req.url).pathname : undefined,
      startedAt: Date.now(),
    };

    // 2) Semua log & error dalam scope handler ini otomatis ter-label requestId.
    return runWithRequestContext(ctx, async () => {
      try {
        if (req && isUnsafeMethod(req.method)) {
          const violation = sameOriginViolation(req.headers, appOriginFrom(env.APP_URL));
          if (violation) {
            // Alasan hanya masuk log server (berisi origin klien); klien dapat pesan umum.
            logger.warn("csrf violation", {
              requestId,
              method: ctx.method,
              path: ctx.path,
              reason: violation,
            });
            throw forbidden("Asal permintaan tidak dikenali.");
          }
          const group = apiGroupFromPath(ctx.path ?? "");
          const ip = clientIpFrom(req.headers);
          await enforceRateLimit(db, apiBucket(group, ip), API_UNSAFE_LIMIT_PER_MINUTE);
        }
        const response = await handler(...args);
        // 3) Echo x-request-id di response header supaya klien bisa korelasi
        //    (mis. untuk laporan bug). Tidak menimpa header yang sudah dipasang handler.
        if (!response.headers.has("x-request-id")) {
          try {
            response.headers.set("x-request-id", requestId);
          } catch {
            // Header yang immutable (NativeResponse) — abaikan, log tetap ter-stamp.
          }
        }
        logger.info("request completed", {
          requestId,
          method: ctx.method,
          path: ctx.path,
          status: response.status,
          durationMs: Date.now() - ctx.startedAt,
        });
        return response;
      } catch (error) {
        unstable_rethrow(error);
        return toErrorResponse(error, requestId);
      }
    });
  };
}

/**
 * Helper untuk auth layer (actor.ts / session.ts) agar dapat men-stamp
 * userId ke konteks aktif setelah login terverifikasi — logger berikutnya
 * otomatis menyertakan userId tanpa perlu mengubah signature handler.
 */
export function annotateActorForLogging(userId: string | undefined): void {
  if (!userId) return;
  annotateRequestContext({ userId });
}