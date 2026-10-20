import { NextResponse } from "next/server";

import { dashboardQuerySchema } from "@/modules/reporting/dashboard-schemas";
import { salesDashboard } from "@/modules/reporting/dashboard-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { parseQuery } from "@/server/validation";

/**
 * Dashboard penjualan: total SO/delivery/invoice/pembayaran/piutang per
 * pelanggan + umur piutang. Izin: reporting.dashboards.read (+ sales.reports.read, sales.ar.read)
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = parseQuery(request, dashboardQuerySchema);
  return NextResponse.json(
    { data: await salesDashboard(actor, query) },
    { headers: { "Cache-Control": "no-store" } },
  );
});
