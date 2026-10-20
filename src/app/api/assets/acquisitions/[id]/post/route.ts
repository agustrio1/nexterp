import { NextResponse } from "next/server";

import { postAcquisition } from "@/modules/assets/acquisition-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { idParamsSchema, parseParams } from "@/server/validation";

type Context = { params: Promise<{ id: string }> };

/** Posting akuisisi (Dr Aset / Cr sumber dana). Izin: assets.acquisitions.post */
export const POST = apiHandler(async (_request: Request, context: Context) => {
  const actor = await requireActor();
  const { id } = await parseParams(context.params, idParamsSchema);
  return NextResponse.json({ data: await postAcquisition(actor, id) });
});
