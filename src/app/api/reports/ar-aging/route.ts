import { NextResponse } from "next/server";

import { arAgingQuerySchema } from "@/modules/sales/report-schemas";
import { arAging } from "@/modules/sales/report-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/**
 * Aging AR: invoice posted bersisa (dikurangi pembayaran + nota kredit posted)
 * dikelompokkan per umur jatuh tempo. Opsional: asOf, customerId, branchId.
 * Izin: sales.ar.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = arAgingQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await arAging(actor, query);

  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});
