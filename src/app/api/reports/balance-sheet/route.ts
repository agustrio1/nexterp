import { NextResponse } from "next/server";

import { balanceSheetQuerySchema } from "@/modules/accounting/report-schemas";
import { balanceSheet } from "@/modules/accounting/report-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/**
 * Neraca: posisi kumulatif Aset vs Kewajiban + Ekuitas (termasuk laba ditahan
 * sementara) per satu tanggal. Query: asOf ATAU periodId, branchId.
 * Izin: accounting.reports.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = balanceSheetQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await balanceSheet(actor, query);

  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});
