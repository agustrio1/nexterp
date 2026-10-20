import { NextResponse } from "next/server";

import { attendanceSummaryQuerySchema } from "@/modules/hr/report-schemas";
import { attendanceSummary } from "@/modules/hr/report-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/**
 * Rekap absensi per status dalam rentang tanggal. Opsional: from, to,
 * departmentId, branchId. Izin: hr.reports.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = attendanceSummaryQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await attendanceSummary(actor, query);

  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});
