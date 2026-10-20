import { NextResponse } from "next/server";

import { dashboardQuerySchema } from "@/modules/reporting/dashboard-schemas";
import { financeDashboard } from "@/modules/reporting/dashboard-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { parseQuery } from "@/server/validation";

/**
 * Dashboard keuangan: laba rugi, neraca, keseimbangan neraca saldo, ringkas
 * arus kas. Izin: reporting.dashboards.read (+ accounting.reports.read)
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = parseQuery(request, dashboardQuerySchema);
  return NextResponse.json(
    { data: await financeDashboard(actor, query) },
    { headers: { "Cache-Control": "no-store" } },
  );
});
