import { z } from "zod";

/**
 * Validasi environment variable sisi server.
 * - Jangan pernah mengimpor file ini dari Client Component.
 * - Jangan membuat variabel NEXT_PUBLIC_* untuk secret.
 * - Set SKIP_ENV_VALIDATION=1 hanya untuk build/CI tanpa env lengkap.
 */

const postgresUrl = z
  .string()
  .min(1)
  .refine((v) => v.startsWith("postgres://") || v.startsWith("postgresql://"), {
    message: "Harus berupa connection string PostgreSQL",
  });

const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Origin publik aplikasi. Bila tidak diset, otomatis dideteksi dari
  // environment Vercel (URL produksi deployment) agar validasi origin/CSRF
  // tetap benar di hosting; fallback hanya untuk development lokal.
  APP_URL: z.url().optional(),
  VERCEL: z.string().optional(),
  VERCEL_URL: z.string().optional(),
  VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
  APP_TIMEZONE: z.string().min(1).default("Asia/Jakarta"),

  DATABASE_URL: postgresUrl,
  // Hanya dibutuhkan oleh Drizzle Kit (migrasi), bukan oleh runtime aplikasi.
  DATABASE_URL_UNPOOLED: postgresUrl.optional(),

  BETTER_AUTH_SECRET: z.string().min(32, "Minimal 32 karakter"),

  AI_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GROQ_API_KEY: z.string().min(1).optional(),

  // Tahap 10D — observability.
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  // Reporter error eksternal; default no-op (stub interface Sentry/lain disiapkan di 10D).
  ERROR_REPORTER: z.enum(["none", "sentry"]).default("none"),
  SENTRY_DSN: z.string().min(1).optional(),
});

export type Env = Omit<z.infer<typeof serverSchema>, "APP_URL"> & { APP_URL: string };

/** `https://<host>` dari hostname Vercel; undefined bila tidak ada. */
function vercelOrigin(host: string | undefined): string | undefined {
  return host ? `https://${host}` : undefined;
}

/**
 * Semua origin deployment Vercel (produksi + preview/URL institusional)
 * untuk `trustedOrigins` Better Auth. Kosong di luar Vercel.
 */
export function trustedOrigins(): string[] {
  return [
    vercelOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL),
    vercelOrigin(process.env.VERCEL_URL),
  ].filter((o): o is string => !!o);
}

function resolveAppUrl(raw: z.infer<typeof serverSchema>): string {
  return (
    raw.APP_URL ??
    vercelOrigin(raw.VERCEL_PROJECT_PRODUCTION_URL) ??
    vercelOrigin(raw.VERCEL_URL) ??
    "http://localhost:3000"
  );
}

function loadEnv(): Env {
  if (process.env.SKIP_ENV_VALIDATION) {
    return process.env as unknown as Env;
  }

  // Nilai kosong (mis. "GEMINI_API_KEY=") dianggap tidak diset.
  const raw = Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value !== undefined && value !== ""),
  );

  const parsed = serverSchema.safeParse(raw);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Konfigurasi environment tidak valid:\n${details}`);
  }

  return { ...parsed.data, APP_URL: resolveAppUrl(parsed.data) };
}

export const env: Env = loadEnv();
export const isProduction = env.NODE_ENV === "production";