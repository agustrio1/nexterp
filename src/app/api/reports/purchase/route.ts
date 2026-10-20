import { NextResponse } from "next/server";

import { purchaseReportQuerySchema } from "@/modules/purchasing/report-schemas";
import { purchaseReport } from "@/modules/purchasing/report-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/**
 * Laporan pembelian: ringkasan PO/GR/invoice/pembayaran per pemasok.
 * Opsional: from, to, supplierId, branchId.
 * Izin: purchasing.reports.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = purchaseReportQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await purchaseReport(actor, query);

  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});
