import { NextResponse } from "next/server";

import { dashboardQuerySchema } from "@/modules/reporting/dashboard-schemas";
import { executiveDashboard } from "@/modules/reporting/dashboard-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { parseQuery } from "@/server/validation";

/**
 * Dashboard eksekutif: laba periode, posisi neraca, piutang & utang, nilai
 * persediaan, headcount. Seluruh angka dari laporan modul sumber.
 * Filter: ?from&to | ?periodId, ?branchId. Izin: reporting.dashboards.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = parseQuery(request, dashboardQuerySchema);
  return NextResponse.json(
    { data: await executiveDashboard(actor, query) },
    { headers: { "Cache-Control": "no-store" } },
  );
});
