import { NextResponse } from "next/server";

import { arGlReconciliation } from "@/modules/sales/report-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/**
 * Rekonsiliasi subledger↔GL AR (posisi kini): Piutang usaha dan Persediaan
 * dibandingkan ke saldo GL akun terkait (jurnal posted+reversed). Parameterless.
 * Izin: sales.reports.read
 */
export const GET = apiHandler(async () => {
  const actor = await requireActor();
  const data = await arGlReconciliation(actor, {});
  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});
