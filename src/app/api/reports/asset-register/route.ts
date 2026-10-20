import { NextResponse } from "next/server";

import { assetRegister } from "@/modules/assets/report-service";
import { assetRegisterQuerySchema } from "@/modules/assets/report-schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/**
 * Register aset tetap (read-only): filter kategori/cabang/status opsional.
 * Nilai buku = biaya perolehan - akumulasi penyusutan. Izin: assets.reports.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = assetRegisterQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const data = await assetRegister(actor, query);
  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});
