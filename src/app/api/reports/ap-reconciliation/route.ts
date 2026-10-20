import { NextResponse } from "next/server";

import { apGlReconciliation } from "@/modules/purchasing/report-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/**
 * Rekonsiliasi subledger↔GL (posisi kini): AP, GR/IR, dan Persediaan dibandingkan
 * ke saldo GL akun terkait (jurnal posted+reversed). Parameterless.
 * Izin: purchasing.reports.read
 */
export const GET = apiHandler(async () => {
  const actor = await requireActor();
  const data = await apGlReconciliation(actor, {});
  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});
