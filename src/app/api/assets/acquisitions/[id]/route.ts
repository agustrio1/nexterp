import { NextResponse } from "next/server";

import { getAcquisition, updateAcquisition } from "@/modules/assets/acquisition-service";
import { updateAcquisitionSchema } from "@/modules/assets/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { idParamsSchema, parseBody, parseParams } from "@/server/validation";

type Context = { params: Promise<{ id: string }> };

/** Detail akuisisi. Izin: assets.acquisitions.read */
export const GET = apiHandler(async (_request: Request, context: Context) => {
  const actor = await requireActor();
  const { id } = await parseParams(context.params, idParamsSchema);
  return NextResponse.json({ data: await getAcquisition(actor, id) });
});

/** Ubah akuisisi draft. Izin: assets.acquisitions.manage */
export const PATCH = apiHandler(async (request: Request, context: Context) => {
  const actor = await requireActor();
  const { id } = await parseParams(context.params, idParamsSchema);
  const input = await parseBody(request, updateAcquisitionSchema);
  return NextResponse.json({ data: await updateAcquisition(actor, id, input) });
});
