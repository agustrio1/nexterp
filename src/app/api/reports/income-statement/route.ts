import { NextResponse } from "next/server";

import { incomeStatementQuerySchema } from "@/modules/accounting/report-schemas";
import { incomeStatement } from "@/modules/accounting/report-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/**
 * Laba rugi: pendapatan vs beban dalam rentang + laba bersih.
 * Query: (from & to ATAU periodId), branchId.
 * Izin: accounting.reports.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = incomeStatementQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await incomeStatement(actor, query);

  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});
