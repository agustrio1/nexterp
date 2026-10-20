import { NextResponse } from "next/server";

import { salesReportQuerySchema } from "@/modules/sales/report-schemas";
import { salesReport } from "@/modules/sales/report-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/**
 * Laporan penjualan: ringkasan SO/delivery/invoice/nota kredit/pembayaran per
 * pelanggan dalam rentang tanggal. Opsional: from, to, customerId, branchId.
 * Izin: sales.reports.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = salesReportQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await salesReport(actor, query);

  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});
