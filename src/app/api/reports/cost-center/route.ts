import { NextResponse } from "next/server";

import { costCenterReportQuerySchema } from "@/modules/accounting/report-schemas";
import { costCenterReport } from "@/modules/accounting/report-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/**
 * Laporan per pusat biaya: pendapatan vs beban per cost center dalam rentang.
 * Query: (from & to ATAU periodId), branchId, costCenterId (opsional).
 * Izin: accounting.reports.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = costCenterReportQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await costCenterReport(actor, query);

  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});
