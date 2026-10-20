import { NextResponse } from "next/server";
import { z } from "zod";

import { replaceBudgetLines } from "@/modules/accounting/budget-service";
import { replaceBudgetLinesSchema } from "@/modules/accounting/budget-schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/**
 * Mengganti SELURUH baris anggaran (semantik PUT). Hanya anggaran draft.
 * Izin: accounting.budgets.manage
 */
export const PUT = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Anggaran tidak ditemukan.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = replaceBudgetLinesSchema.parse(body);
  const data = await replaceBudgetLines(actor, parsed.data, input);

  return NextResponse.json({ data });
});
