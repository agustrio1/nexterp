import { NextResponse } from "next/server";

import { expiryScheduleQuerySchema } from "@/modules/inventory/report-schemas";
import { expirySchedule } from "@/modules/inventory/report-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/**
 * Jadwal kedaluwarsa (FEFO/expiry): lapisan bersisa bertanggal expiry, urut
 * terdekat. Opsional: asOf, withinDays, includeExpired, productId, warehouseId, branchId.
 * Izin: inventory.stock.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = expiryScheduleQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await expirySchedule(actor, query);

  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});
