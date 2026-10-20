import { NextResponse } from "next/server";

import { trialBalanceQuerySchema } from "@/modules/accounting/report-schemas";
import { trialBalance } from "@/modules/accounting/report-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/**
 * Neraca saldo: total debit & kredit per akun yang punya mutasi dalam rentang,
 * plus total keseluruhan (harus seimbang). Query: (from & to ATAU periodId), branchId.
 * Izin: accounting.reports.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = trialBalanceQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await trialBalance(actor, query);

  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});
