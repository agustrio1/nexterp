import { NextResponse } from "next/server";

import { dashboardQuerySchema } from "@/modules/reporting/dashboard-schemas";
import { purchasingDashboard } from "@/modules/reporting/dashboard-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { parseQuery } from "@/server/validation";

/**
 * Dashboard pembelian: total PO/GR/invoice/pembayaran/utang per pemasok +
 * umur utang. Izin: reporting.dashboards.read (+ purchasing.reports.read, purchasing.ap.read)
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = parseQuery(request, dashboardQuerySchema);
  return NextResponse.json(
    { data: await purchasingDashboard(actor, query) },
    { headers: { "Cache-Control": "no-store" } },
  );
});
