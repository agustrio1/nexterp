import { NextResponse } from "next/server";

import { getComponent, updateComponent } from "@/modules/payroll/component-service";
import { updateComponentSchema } from "@/modules/payroll/schemas";
import { readId, readJson } from "@/app/api/payroll/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

type Ctx = { params: Promise<{ id: string }> };

/** Detail komponen. Izin: payroll.components.read */
export const GET = apiHandler(async (_request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Komponen");
  return NextResponse.json({ data: await getComponent(actor, id) });
});

/** Ubah komponen. Izin: payroll.components.manage */
export const PATCH = apiHandler(async (request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Komponen");
  const input = updateComponentSchema.parse(await readJson(request));
  return NextResponse.json({ data: await updateComponent(actor, id, input) });
});
