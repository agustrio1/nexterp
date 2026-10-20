import { NextResponse } from "next/server";

import { projectProfitability } from "@/modules/projects/report-service";
import { profitabilityQuerySchema } from "@/modules/projects/report-schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/**
 * Profitabilitas proyek (read-only): revenue/cost/margin diturunkan dari
 * jurnal posted+reversed yang tag cost center proyek; plus varian anggaran.
 * Filter projectId/from/to opsional. Izin: projects.reports.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = profitabilityQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const data = await projectProfitability(actor, query);
  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});
