import { eq } from "drizzle-orm";

import { aiSettings } from "@/db/schema";
import { audit } from "@/server/audit";
import type { AuthContext } from "@/server/authz";
import { db } from "@/server/db";

import { AI_SETTINGS_ID, assertCan, inTx, requireSettingsRow } from "./_refs";
import type { UpdateAiSettingsInput } from "./schemas";

/* ------------------------------------------------------------------ */
/* Layanan konfigurasi AI (Tahap 9B). Satu baris tunggal (singleton).   */
/* Nilai yang tersimpan hanyalah konfigurasi (bukan data bisnis), jadi   */
/* aman diaudit dan aman dibaca UI.                                      */
/* ------------------------------------------------------------------ */

function summarize(row: typeof aiSettings.$inferSelect) {
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    enabled: row.enabled,
    maxInputChars: row.maxInputChars,
    maxOutputTokens: row.maxOutputTokens,
    rateLimitPerMinute: row.rateLimitPerMinute,
    dailyRequestLimit: row.dailyRequestLimit,
    updatedAt: row.updatedAt,
  };
}

/** Baca konfigurasi AI. Izin: ai.settings.read */
export async function getAiSettings(actor: AuthContext) {
  assertCan(actor, "ai.settings.read");
  return summarize(await requireSettingsRow(db));
}

/** Ubah konfigurasi AI (sebagian; hanya kunci yang dikirim yang berubah). Izin: ai.settings.manage */
export async function updateAiSettings(actor: AuthContext, input: UpdateAiSettingsInput) {
  assertCan(actor, "ai.settings.manage");

  return inTx(undefined, async (tx) => {
    const [existing] = await tx.select().from(aiSettings).where(eq(aiSettings.id, AI_SETTINGS_ID)).limit(1);
    if (!existing) throw new Error("Baris konfigurasi AI belum ada (jalankan seed).");

    // `?? existing.x` aman: 0/false bukan nullish sehingga tetap honoured.
    // `model` boleh di-set null (clear) -> cek keberadaan kunci, bukan nullish.
    const set = {
      provider: input.provider ?? existing.provider,
      model: "model" in input ? (input.model ?? null) : existing.model,
      enabled: input.enabled ?? existing.enabled,
      maxInputChars: input.maxInputChars ?? existing.maxInputChars,
      maxOutputTokens: input.maxOutputTokens ?? existing.maxOutputTokens,
      rateLimitPerMinute: input.rateLimitPerMinute ?? existing.rateLimitPerMinute,
      dailyRequestLimit: input.dailyRequestLimit ?? existing.dailyRequestLimit,
      updatedBy: actor.userId,
      updatedAt: new Date(),
    };

    const [updated] = await tx
      .update(aiSettings)
      .set(set)
      .where(eq(aiSettings.id, AI_SETTINGS_ID))
      .returning();

    await audit.log(
      {
        action: "ai.settings.update",
        entityType: "ai_settings",
        entityId: AI_SETTINGS_ID,
        actorId: actor.userId,
        before: summarize(existing),
        after: summarize(updated),
      },
      tx,
    );

    return summarize(updated);
  });
}
