import { NextResponse } from "next/server";

import { deleteBracket, updateBracket } from "@/modules/payroll/statutory-service";
import { updateBracketSchema } from "@/modules/payroll/schemas";
import { readId, readJson } from "@/app/api/payroll/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

type Ctx = { params: Promise<{ id: string }> };

/** Ubah bracket. Izin: payroll.statutory.manage */
export const PATCH = apiHandler(async (request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Bracket");
  const input = updateBracketSchema.parse(await readJson(request));
  return NextResponse.json({ data: await updateBracket(actor, id, input) });
});

/** Hapus bracket. Izin: payroll.statutory.manage */
export const DELETE = apiHandler(async (_request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Bracket");
  return NextResponse.json({ data: await deleteBracket(actor, id) });
});
