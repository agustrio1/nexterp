import { NextResponse } from "next/server";

import { assetGlReconciliation } from "@/modules/assets/report-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/**
 * Rekonsiliasi subledger↔GL aset (posisi kini): harga perolehan, akumulasi
 * penyusutan, dan beban penyusutan dibandingkan ke GL (jurnal posted+reversed).
 * Parameterless. Izin: assets.reports.read
 */
export const GET = apiHandler(async () => {
  const actor = await requireActor();
  const data = await assetGlReconciliation(actor, {});
  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});
