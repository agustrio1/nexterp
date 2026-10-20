import { NextResponse } from "next/server";

import { listPayslips } from "@/modules/payroll/payslip-service";
import { readUuidParam } from "@/app/api/payroll/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/** Daftar slip gaji. ?employeeId=. Izin: payroll.payslips.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const employeeId = readUuidParam(new URL(request.url).searchParams.get("employeeId"));
  return NextResponse.json({ data: await listPayslips(actor, { employeeId }) });
});
