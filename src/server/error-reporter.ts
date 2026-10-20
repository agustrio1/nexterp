import { env } from "@/config/env";
import { logger } from "@/server/logger";

/**
 * Interface reporter error eksternal (Sentry/OTel dsb.). Default no-op —
 * cukup untuk menjalankan aplikasi tanpa vendor. `ERROR_REPORTER=sentry`
 * + `SENTRY_DSN` disiapkan sebagai kontrak konfigurasi; SDK itu sendiri
 * TIDAK dipasang di Tahap 10D (biaya & kompleksitas di luar scope) — lihat
 * docs/OPERATIONS.md #error-tracking untuk cara wiring saat dibutuhkan.
 *
 * Kenapa interface dan bukan langsung Sentry.captureException:
 * - Unit test bisa inject stub tanpa mock module.
 * - Route handler & worker tetap bisa memanggil satu API (`reportError`)
 *   tanpa tahu vendor aktif atau tidak.
 * - Kegagalan reporter TIDAK boleh menjatuhkan request — di-wrap try/catch.
 */
export type ErrorReportContext = {
  requestId: string;
  path?: string;
  method?: string;
  userId?: string;
};

export type ErrorReporter = {
  name: string;
  report(error: unknown, ctx: ErrorReportContext): void;
};

const noopReporter: ErrorReporter = {
  name: "none",
  report: () => undefined,
};

let active: ErrorReporter = noopReporter;

/** Ganti reporter aktif. Dipanggil dari bootstrap / wiring test. */
export function setErrorReporter(reporter: ErrorReporter): void {
  active = reporter;
  logger.info("error reporter wired", { reporter: reporter.name });
}

/** Reporter aktif (untuk introspeksi / test). */
export function getErrorReporter(): ErrorReporter {
  return active;
}

/**
 * Panggil reporter aktif; kegagalan reporter di-log lalu ditelan agar
 * tidak mengganggu flow error utama di apiHandler.
 */
export function reportError(error: unknown, ctx: ErrorReportContext): void {
  try {
    active.report(error, ctx);
  } catch (reporterError) {
    logger.warn("error reporter failed", {
      reporter: active.name,
      requestId: ctx.requestId,
      // Simpan pesan reporter, bukan error asli (sudah di-log oleh apiHandler).
      reporterErrorMessage:
        reporterError instanceof Error ? reporterError.message : String(reporterError),
    });
  }
}

/**
 * Placeholder wiring Sentry — TIDAK memanggil SDK Sentry (belum dipasang).
 * Bila `ERROR_REPORTER=sentry` tapi SDK belum di-install, logger akan
 * memperingatkan sekali saat bootstrap dan reporter tetap no-op.
 * Wiring nyata: buat file `src/server/reporters/sentry.ts` yang mengimpor
 * SDK-nya lalu daftarkan lewat `setErrorReporter`.
 */
export function initErrorReporter(): void {
  const choice = (env as { ERROR_REPORTER?: "none" | "sentry" }).ERROR_REPORTER ?? "none";
  if (choice === "none") return;
  if (choice === "sentry") {
    const dsn = (env as { SENTRY_DSN?: string }).SENTRY_DSN;
    if (!dsn) {
      logger.warn("error reporter=sentry but SENTRY_DSN missing; staying no-op");
      return;
    }
    logger.warn(
      "error reporter=sentry requested tetapi SDK belum dipasang; aktif tetap no-op. " +
        "Lihat docs/OPERATIONS.md #error-tracking untuk prosedur wiring.",
    );
  }
}
