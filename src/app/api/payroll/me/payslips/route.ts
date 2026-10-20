import { NextResponse } from "next/server";

import { getMyPayslips } from "@/modules/payroll/self-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/** Slip gaji milik karyawan tertaut akun sesi. Izin: payroll.self.payslip */
export const GET = apiHandler(async () => {
  const actor = await requireActor();
  return NextResponse.json({ data: await getMyPayslips(actor) });
});
