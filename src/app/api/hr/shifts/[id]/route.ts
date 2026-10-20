import { NextResponse } from "next/server";

import { getShift, updateShift } from "@/modules/hr/shift-service";
import { updateShiftSchema } from "@/modules/hr/schemas";
import { readId, readJson } from "@/app/api/hr/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

type Ctx = { params: Promise<{ id: string }> };

/** Detail shift. Izin: hr.shifts.read */
export const GET = apiHandler(async (_request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Shift");
  return NextResponse.json({ data: await getShift(actor, id) });
});

/** Ubah shift. Izin: hr.shifts.manage */
export const PATCH = apiHandler(async (request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Shift");
  const input = updateShiftSchema.parse(await readJson(request));
  return NextResponse.json({ data: await updateShift(actor, id, input) });
});
