import { NextResponse } from "next/server";

import { postRun } from "@/modules/assets/depreciation-run-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { idParamsSchema, parseParams } from "@/server/validation";

type Context = { params: Promise<{ id: string }> };

/** Posting run (Dr Beban penyusutan / Cr Akumulasi) + terapkan ke register. Izin: assets.depreciation.post */
export const POST = apiHandler(async (_request: Request, context: Context) => {
  const actor = await requireActor();
  const { id } = await parseParams(context.params, idParamsSchema);
  return NextResponse.json({ data: await postRun(actor, id) });
});
