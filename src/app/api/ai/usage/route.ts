import { NextResponse } from "next/server";

import { usageByUser, usageSummary } from "@/modules/ai/usage-service";
import { usageQuerySchema } from "@/modules/ai/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { parseQuery } from "@/server/validation";

/**
 * Dasbor pemakaian AI (metadata `ai_requests` — tanpa prompt/respons).
 * Query: from?, to?, feature?, userId? (semua opsional).
 * Izin: ai.requests.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = parseQuery(request, usageQuerySchema);
  const [summary, byUser] = await Promise.all([usageSummary(actor, query), usageByUser(actor, query)]);
  return NextResponse.json({ data: { summary, byUser } }, { headers: { "Cache-Control": "no-store" } });
});
