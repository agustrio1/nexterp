import { NextResponse } from "next/server";

import { apAgingQuerySchema } from "@/modules/purchasing/report-schemas";
import { apAging } from "@/modules/purchasing/report-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/**
 * Aging AP: invoice posted bersisa dikelompokkan per umur jatuh tempo.
 * Opsional: asOf, supplierId, branchId.
 * Izin: purchasing.ap.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = apAgingQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await apAging(actor, query);

  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});
