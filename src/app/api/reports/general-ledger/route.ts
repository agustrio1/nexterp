import { NextResponse } from "next/server";

import {
  generalLedgerQuerySchema,
} from "@/modules/accounting/report-schemas";
import { generalLedger } from "@/modules/accounting/report-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/**
 * Buku besar per akun: saldo awal, mutasi berurutan dengan saldo berjalan, saldo akhir.
 * Query (wajib): accountId + (from & to ATAU periodId). Opsional: branchId, departmentId.
 * Izin: accounting.reports.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = generalLedgerQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await generalLedger(actor, query);

  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});
