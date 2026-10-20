import { NextResponse } from "next/server";

import { dashboardQuerySchema } from "@/modules/reporting/dashboard-schemas";
import { inventoryDashboard } from "@/modules/reporting/dashboard-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { parseQuery } from "@/server/validation";

/**
 * Dashboard persediaan: valuasi (posisi kini), produk di bawah titik pesan,
 * dan lapisan dekat kedaluwarsa. Izin: reporting.dashboards.read (+ inventory.stock.read)
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = parseQuery(request, dashboardQuerySchema);
  return NextResponse.json(
    { data: await inventoryDashboard(actor, query) },
    { headers: { "Cache-Control": "no-store" } },
  );
});
