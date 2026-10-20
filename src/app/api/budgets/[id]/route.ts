import { NextResponse } from "next/server";
import { z } from "zod";

import { getBudget, updateBudget } from "@/modules/accounting/budget-service";
import { updateBudgetSchema } from "@/modules/accounting/budget-schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/** Detail anggaran beserta barisnya. Izin: accounting.budgets.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Anggaran tidak ditemukan.");

  const data = await getBudget(actor, parsed.data);
  return NextResponse.json({ data });
});

/** Memperbarui header anggaran (hanya saat draft). Izin: accounting.budgets.manage */
export const PATCH = apiHandler(async (request: Request, context: IdContext) => {
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

  const input = updateBudgetSchema.parse(body);
  const data = await updateBudget(actor, parsed.data, input);

  return NextResponse.json({ data });
});
