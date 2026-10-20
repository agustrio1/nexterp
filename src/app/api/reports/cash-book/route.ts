import { NextResponse } from "next/server";

import { cashBookQuerySchema } from "@/modules/accounting/report-schemas";
import { cashBook } from "@/modules/accounting/report-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/**
 * Buku kas/bank: mutasi + saldo berjalan satu rekening dalam rentang.
 * Query: bankAccountId + ((from & to) ATAU periodId), branchId (opsional).
 * Izin: accounting.reports.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = cashBookQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await cashBook(actor, query);

  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});
