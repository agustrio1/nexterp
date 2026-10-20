import { NextResponse } from "next/server";

import { createBudget, listBudgets } from "@/modules/accounting/budget-service";
import {
  createBudgetSchema,
  listBudgetsQuerySchema,
} from "@/modules/accounting/budget-schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/**
 * Daftar anggaran.
 * Filter: ?fiscalYearId=<uuid>, ?branchId=<uuid>, ?status=draft|approved
 * Izin: accounting.budgets.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = listBudgetsQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await listBudgets(actor, query);

  return NextResponse.json({ data });
});

/** Membuat anggaran draf (header + baris sekaligus). Izin: accounting.budgets.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = createBudgetSchema.parse(body);
  const data = await createBudget(actor, input);

  return NextResponse.json({ data }, { status: 201 });
});
