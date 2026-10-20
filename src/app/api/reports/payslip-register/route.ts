import { NextResponse } from "next/server";

import { payslipRegisterQuerySchema } from "@/modules/payroll/report-schemas";
import { payslipRegister } from "@/modules/payroll/report-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/**
 * Daftar slip gaji per run/karyawan. Opsional: runId, employeeId.
 * Izin: payroll.reports.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = payslipRegisterQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await payslipRegister(actor, query);

  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});
