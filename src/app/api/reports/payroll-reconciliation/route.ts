import { NextResponse } from "next/server";

import { payrollGlReconciliation } from "@/modules/payroll/report-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/**
 * Rekonsiliasi subledger↔GL payroll (posisi kini): total run posted dibandingkan
 * ke saldo GL akun payroll (jurnal posted+reversed). Parameterless.
 * Izin: payroll.reports.read
 */
export const GET = apiHandler(async () => {
  const actor = await requireActor();
  const data = await payrollGlReconciliation(actor, {});
  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});
