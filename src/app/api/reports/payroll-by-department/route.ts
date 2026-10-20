import { NextResponse } from "next/server";

import { payrollCostByDepartmentQuerySchema } from "@/modules/payroll/report-schemas";
import { payrollCostByDepartment } from "@/modules/payroll/report-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/**
 * Beban gaji per departemen dari run posted (gross, potongan, net, pajak, BPJS).
 * Opsional: periodId, branchId. Izin: payroll.reports.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = payrollCostByDepartmentQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await payrollCostByDepartment(actor, query);

  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});
