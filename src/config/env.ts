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
  APP_URL: z.url().default("http://localhost:3000"),
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

export type Env = z.infer<typeof serverSchema>;

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

  return parsed.data;
}

export const env: Env = loadEnv();
export const isProduction = env.NODE_ENV === "production";