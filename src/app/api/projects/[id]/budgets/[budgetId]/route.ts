import { NextResponse } from "next/server";
import { z } from "zod";

import { removeProjectBudget, updateProjectBudget } from "@/modules/projects/budget-service";
import { updateProjectBudgetSchema } from "@/modules/projects/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { parseBody, parseParams } from "@/server/validation";

const paramsSchema = z.object({
  id: z.uuid("ID tidak valid."),
  budgetId: z.uuid("ID tidak valid."),
});

type Context = { params: Promise<{ id: string; budgetId: string }> };

/** Ubah anggaran proyek. Izin: projects.budgets.manage */
export const PATCH = apiHandler(async (request: Request, context: Context) => {
  const actor = await requireActor();
  const { id, budgetId } = await parseParams(context.params, paramsSchema);
  const input = await parseBody(request, updateProjectBudgetSchema);
  return NextResponse.json({ data: await updateProjectBudget(actor, id, budgetId, input) });
});

/** Hapus anggaran proyek. Izin: projects.budgets.manage */
export const DELETE = apiHandler(async (_request: Request, context: Context) => {
  const actor = await requireActor();
  const { id, budgetId } = await parseParams(context.params, paramsSchema);
  return NextResponse.json({ data: await removeProjectBudget(actor, id, budgetId) });
});
