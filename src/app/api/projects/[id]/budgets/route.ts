import { NextResponse } from "next/server";

import { createProjectBudget, listProjectBudgets } from "@/modules/projects/budget-service";
import { createProjectBudgetSchema } from "@/modules/projects/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { idParamsSchema, parseBody, parseParams } from "@/server/validation";

type Context = { params: Promise<{ id: string }> };

/** Daftar anggaran proyek (per akun/periode atau agregat). Izin: projects.master.read */
export const GET = apiHandler(async (_request: Request, context: Context) => {
  const actor = await requireActor();
  const { id } = await parseParams(context.params, idParamsSchema);
  return NextResponse.json({ data: await listProjectBudgets(actor, id) });
});

/** Tambah anggaran proyek. Izin: projects.budgets.manage */
export const POST = apiHandler(async (request: Request, context: Context) => {
  const actor = await requireActor();
  const { id } = await parseParams(context.params, idParamsSchema);
  const input = await parseBody(request, createProjectBudgetSchema);
  return NextResponse.json({ data: await createProjectBudget(actor, id, input) }, { status: 201 });
});
