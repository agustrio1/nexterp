import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { actorColumns } from "./_actors";
import { primaryId, timestamps, timestamptz } from "./_columns";
import { users } from "./identity";

/* ------------------------------------------------------------------ */
/* Integrasi AI (Tahap 9A-9C).                                         */
/* AI BUKAN sumber kebenaran: ia hanya meringkas angka yang dihitung   */
/* service deterministik. Konfigurasi & kuota disimpan di `ai_settings` */
/* (satu baris tunggal); setiap percobaan tercatat di `ai_requests`     */
/* TANPA prompt/response mentah (minimisasi data — free tier Google     */
/* memakai konten untuk meningkatkan produk).                          */
/* ------------------------------------------------------------------ */

export const aiProviderEnum = pgEnum("ai_provider", ["gemini", "fake", "none"]);
export const aiRequestStatusEnum = pgEnum("ai_request_status", [
  "ok",
  "error",
  "rate_limited",
  "disabled",
  "unauthorized",
  "validation",
]);

/**
 * Satu baris konfigurasi AI (singleton). Baris dibuat seed dengan id konstan;
 * layanan membaca/menulis baris itu, tidak pernah membuat baris kedua
 * (dijaga unique index pada kolom `singleton` yang selalu true).
 * `enabled=false` ATAU provider `none` -> asisten menolak sebelum memanggil provider.
 * Limit & model disimpan di sini (bukan hard-code) karena kuota free tier berubah-ubah.
 */
export const aiSettings = pgTable(
  "ai_settings",
  {
    id: primaryId(),
    provider: aiProviderEnum().notNull().default("none"),
    /** Id model bebas (diisi dari AI Studio); null = belum dikonfigurasi. */
    model: text(),
    enabled: boolean().notNull().default(false),
    maxInputChars: integer().notNull().default(4000),
    maxOutputTokens: integer().notNull().default(1000),
    /** Penegakan kuota sisi aplikasi (best-effort) di samping limit project Google. */
    rateLimitPerMinute: integer().notNull().default(6),
    dailyRequestLimit: integer().notNull().default(60),
    /** Kolom penjaga singleton: selalu true + unique => maksimal satu baris. */
    singleton: boolean().notNull().default(true),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("ai_settings_singleton_uq").on(t.singleton),
    check("ai_settings_max_input_chk", sql`${t.maxInputChars} >= 1`),
    check("ai_settings_max_output_chk", sql`${t.maxOutputTokens} >= 1`),
    check("ai_settings_rpm_chk", sql`${t.rateLimitPerMinute} >= 0`),
    check("ai_settings_daily_chk", sql`${t.dailyRequestLimit} >= 0`),
  ],
);

/**
 * Log pemakaian AI, append-only. Disengaja TIDAK menyimpan prompt atau respons:
 * hanya metadata (fitur, provider, model, status, token, latensi, reportKey,
 * filter aman) agar aman untuk free tier dan siap jadi dasbor pemakaian (9F).
 */
export const aiRequests = pgTable(
  "ai_requests",
  {
    id: primaryId(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    /** Fitur pemanggil, mis. "report.assistant". */
    feature: text().notNull(),
    provider: text().notNull(),
    model: text(),
    status: aiRequestStatusEnum().notNull(),
    /** reportKey hasil intent (untuk jejak audit), bukan teks pertanyaan. */
    reportKey: text(),
    /** Hanya parameter aman (mis. rentang tanggal), BUKAN nilai baris data. */
    filters: jsonb(),
    inputTokens: integer().notNull().default(0),
    outputTokens: integer().notNull().default(0),
    /** Biaya per token; free tier => 0. Selalu string desimal (tanpa floating). */
    estimatedCost: numeric({ precision: 18, scale: 6 }).notNull().default("0"),
    durationMs: integer(),
    errorClass: text(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    index("ai_requests_user_created_idx").on(t.userId, t.createdAt),
    index("ai_requests_created_idx").on(t.createdAt),
    check("ai_requests_input_tokens_chk", sql`${t.inputTokens} >= 0`),
    check("ai_requests_output_tokens_chk", sql`${t.outputTokens} >= 0`),
  ],
);
