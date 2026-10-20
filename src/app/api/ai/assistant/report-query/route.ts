import { NextResponse } from "next/server";

import { askReportFromSession } from "@/modules/ai/assistant-service";
import { askReportQuerySchema } from "@/modules/ai/schemas";
import { apiHandler } from "@/server/errors";
import { parseBody } from "@/server/validation";

/**
 * Asisten bahasa alami -> laporan. Body: { question, filters? }.
 * Alur: intent -> validasi -> otorisasi -> service laporan -> ringkasan AI.
 * Angka selalu dari service (deterministik); AI tidak menghitung / tidak menulis SQL.
 * Izin: ai.assistant.use + izin baca laporan sumber.
 */
export const POST = apiHandler(async (request: Request) => {
  const input = await parseBody(request, askReportQuerySchema);
  const data = await askReportFromSession(input);
  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});
