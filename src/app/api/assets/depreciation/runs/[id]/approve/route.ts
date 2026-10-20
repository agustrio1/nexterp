import { NextResponse } from "next/server";

import { approveRun } from "@/modules/assets/depreciation-run-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { idParamsSchema, parseParams } from "@/server/validation";

type Context = { params: Promise<{ id: string }> };

/** Setujui run (SoD). Izin: assets.depreciation.post */
export const POST = apiHandler(async (_request: Request, context: Context) => {
  const actor = await requireActor();
  const { id } = await parseParams(context.params, idParamsSchema);
  return NextResponse.json({ data: await approveRun(actor, id) });
});
