import { NextResponse } from "next/server";

import { cashFlowQuerySchema } from "@/modules/accounting/report-schemas";
import { cashFlowStatement } from "@/modules/accounting/report-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/**
 * Laporan arus kas (metode langsung, sumber transaksi kas terposting).
 * Query: ((from & to) ATAU periodId), branchId (opsional).
 * Izin: accounting.reports.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = cashFlowQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await cashFlowStatement(actor, query);

  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});
