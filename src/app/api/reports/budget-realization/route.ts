import { NextResponse } from "next/server";

import { budgetRealizationQuerySchema } from "@/modules/accounting/report-schemas";
import { budgetRealization } from "@/modules/accounting/report-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/**
 * Realisasi vs anggaran. Query: budgetId (wajib), periodId (opsional).
 * Izin: accounting.budgets.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = budgetRealizationQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await budgetRealization(actor, query);

  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});
