import { NextResponse } from "next/server";

import { reverseDisposal } from "@/modules/assets/disposal-service";
import { reasonInputSchema } from "@/modules/assets/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { idParamsSchema, parseBody, parseParams } from "@/server/validation";

type Context = { params: Promise<{ id: string }> };

/** Balik pelepasan posted (aktifkan kembali aset, reversal jurnal). Izin: assets.disposal.post */
export const POST = apiHandler(async (request: Request, context: Context) => {
  const actor = await requireActor();
  const { id } = await parseParams(context.params, idParamsSchema);
  const { reason } = await parseBody(request, reasonInputSchema);
  return NextResponse.json({ data: await reverseDisposal(actor, id, reason) });
});
