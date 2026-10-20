import { NextResponse } from "next/server";

import { dashboardQuerySchema } from "@/modules/reporting/dashboard-schemas";
import { cashFlowDashboard } from "@/modules/reporting/dashboard-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { parseQuery } from "@/server/validation";

/**
 * Dashboard arus kas: per seksi (operasi/investasi/pendanaan), rekonsiliasi ke
 * perubahan saldo GL kas/bank, dan saldo per rekening.
 * Izin: reporting.dashboards.read (+ accounting.reports.read)
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = parseQuery(request, dashboardQuerySchema);
  return NextResponse.json(
    { data: await cashFlowDashboard(actor, query) },
    { headers: { "Cache-Control": "no-store" } },
  );
});
