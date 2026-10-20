import { NextResponse } from "next/server";

import { headcountQuerySchema } from "@/modules/hr/report-schemas";
import { headcountByDepartment } from "@/modules/hr/report-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/**
 * Headcount karyawan aktif per departemen. Opsional: branchId.
 * Izin: hr.reports.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = headcountQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await headcountByDepartment(actor, query);

  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});
