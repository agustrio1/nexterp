import { NextResponse } from "next/server";

import { dashboardQuerySchema } from "@/modules/reporting/dashboard-schemas";
import { hrDashboard } from "@/modules/reporting/dashboard-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { parseQuery } from "@/server/validation";

/**
 * Dashboard SDM: headcount per departemen, rekap absensi periode, dan saldo
 * cuti. Tidak menyentuh remunerasi. Izin: reporting.dashboards.read (+ hr.reports.read)
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = parseQuery(request, dashboardQuerySchema);
  return NextResponse.json(
    { data: await hrDashboard(actor, query) },
    { headers: { "Cache-Control": "no-store" } },
  );
});
