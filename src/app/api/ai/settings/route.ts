import { NextResponse } from "next/server";

import { getAiSettings, updateAiSettings } from "@/modules/ai/settings-service";
import { updateAiSettingsSchema } from "@/modules/ai/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { parseBody } from "@/server/validation";

/**
 * Konfigurasi AI tunggal (provider, model, saklar, limit). Tidak memuat data bisnis.
 * Izin: ai.settings.read
 */
export const GET = apiHandler(async () => {
  const actor = await requireActor();
  const data = await getAiSettings(actor);
  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});

/**
 * Ubah konfigurasi AI sebagian. Body: { provider?, model?|null, enabled?, maxInputChars?,
 * maxOutputTokens?, rateLimitPerMinute?, dailyRequestLimit? }.
 * Izin: ai.settings.manage
 */
export const PUT = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const input = await parseBody(request, updateAiSettingsSchema);
  const data = await updateAiSettings(actor, input);
  return NextResponse.json({ data });
});
