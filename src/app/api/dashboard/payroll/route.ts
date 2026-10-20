import { NextResponse } from "next/server";

import { dashboardQuerySchema } from "@/modules/reporting/dashboard-schemas";
import { payrollDashboard } from "@/modules/reporting/dashboard-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { parseQuery } from "@/server/validation";

/**
 * Dashboard payroll: beban gaji run terposting per departemen (gross, pajak,
 * BPJS, biaya total). Izin: reporting.dashboards.read (+ payroll.reports.read)
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = parseQuery(request, dashboardQuerySchema);
  return NextResponse.json(
    { data: await payrollDashboard(actor, query) },
    { headers: { "Cache-Control": "no-store" } },
  );
});
