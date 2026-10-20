import { NextResponse } from "next/server";

import { cancelRun } from "@/modules/assets/depreciation-run-service";
import { reasonInputSchema } from "@/modules/assets/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { idParamsSchema, parseBody, parseParams } from "@/server/validation";

type Context = { params: Promise<{ id: string }> };

/** Batalkan run draft/calculated. Izin: assets.depreciation.manage */
export const POST = apiHandler(async (request: Request, context: Context) => {
  const actor = await requireActor();
  const { id } = await parseParams(context.params, idParamsSchema);
  const { reason } = await parseBody(request, reasonInputSchema);
  return NextResponse.json({ data: await cancelRun(actor, id, reason) });
});
