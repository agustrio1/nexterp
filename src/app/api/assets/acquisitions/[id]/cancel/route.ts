import { NextResponse } from "next/server";

import { cancelAcquisition } from "@/modules/assets/acquisition-service";
import { reasonInputSchema } from "@/modules/assets/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { idParamsSchema, parseBody, parseParams } from "@/server/validation";

type Context = { params: Promise<{ id: string }> };

/** Batalkan akuisisi draft. Izin: assets.acquisitions.manage */
export const POST = apiHandler(async (request: Request, context: Context) => {
  const actor = await requireActor();
  const { id } = await parseParams(context.params, idParamsSchema);
  const { reason } = await parseBody(request, reasonInputSchema);
  return NextResponse.json({ data: await cancelAcquisition(actor, id, reason) });
});
