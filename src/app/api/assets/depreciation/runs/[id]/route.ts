import { NextResponse } from "next/server";

import { getRun } from "@/modules/assets/depreciation-run-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { idParamsSchema, parseParams } from "@/server/validation";

type Context = { params: Promise<{ id: string }> };

/** Detail run penyusutan + item. Izin: assets.depreciation.read */
export const GET = apiHandler(async (_request: Request, context: Context) => {
  const actor = await requireActor();
  const { id } = await parseParams(context.params, idParamsSchema);
  return NextResponse.json({ data: await getRun(actor, id) });
});
