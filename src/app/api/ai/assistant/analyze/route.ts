import { NextResponse } from "next/server";

import { askAnalysisFromSession } from "@/modules/ai/assistant-service";
import { analyzeQuerySchema } from "@/modules/ai/schemas";
import { apiHandler } from "@/server/errors";
import { parseBody } from "@/server/validation";

/**
 * Asisten analisis (tren/anomali) berbasis bahasa alami. Body: { question, analysisKey?, params? }.
 * Alur: intent -> validasi parameter -> otorisasi -> hitung deterministik (analytics.ts) -> AI menjelaskan.
 * Angka selalu dari service; AI tidak menghitung / tidak menulis SQL.
 * Izin: ai.assistant.use + izin baca sumber tiap analisis (re-check server).
 */
export const POST = apiHandler(async (request: Request) => {
  const input = await parseBody(request, analyzeQuerySchema);
  const data = await askAnalysisFromSession(input);
  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});
