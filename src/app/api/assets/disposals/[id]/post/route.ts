import { NextResponse } from "next/server";

import { postDisposal } from "@/modules/assets/disposal-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { idParamsSchema, parseParams } from "@/server/validation";

type Context = { params: Promise<{ id: string }> };

/** Posting pelepasan (hentikan aset, jurnal hapus cost/akumulasi + laba/rugi). Izin: assets.disposal.post */
export const POST = apiHandler(async (_request: Request, context: Context) => {
  const actor = await requireActor();
  const { id } = await parseParams(context.params, idParamsSchema);
  return NextResponse.json({ data: await postDisposal(actor, id) });
});
