import { NextResponse } from "next/server";

import { getPosition, updatePosition } from "@/modules/hr/position-service";
import { updatePositionSchema } from "@/modules/hr/schemas";
import { readId, readJson } from "@/app/api/hr/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

type Ctx = { params: Promise<{ id: string }> };

/** Detail jabatan. Izin: hr.positions.read */
export const GET = apiHandler(async (_request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Jabatan");
  return NextResponse.json({ data: await getPosition(actor, id) });
});

/** Ubah jabatan. Izin: hr.positions.manage */
export const PATCH = apiHandler(async (request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Jabatan");
  const input = updatePositionSchema.parse(await readJson(request));
  return NextResponse.json({ data: await updatePosition(actor, id, input) });
});
