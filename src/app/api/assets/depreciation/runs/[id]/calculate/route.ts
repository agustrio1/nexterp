import { NextResponse } from "next/server";

import { calculateRun } from "@/modules/assets/depreciation-run-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { idParamsSchema, parseParams } from "@/server/validation";

type Context = { params: Promise<{ id: string }> };

/** Hitung penyusutan run (snapshot item + jadwal). Izin: assets.depreciation.manage */
export const POST = apiHandler(async (_request: Request, context: Context) => {
  const actor = await requireActor();
  const { id } = await parseParams(context.params, idParamsSchema);
  return NextResponse.json({ data: await calculateRun(actor, id) });
});
