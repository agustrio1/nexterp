import { NextResponse } from "next/server";

import { leaveBalancesQuerySchema } from "@/modules/hr/report-schemas";
import { leaveBalancesReport } from "@/modules/hr/report-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/**
 * Saldo cuti per karyawan/jenis untuk suatu tahun (sisa = total - terpakai).
 * Opsional: year, departmentId. Izin: hr.reports.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = leaveBalancesQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await leaveBalancesReport(actor, query);

  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});
