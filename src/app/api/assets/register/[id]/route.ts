import { NextResponse } from "next/server";

import { getAsset, updateAsset } from "@/modules/assets/asset-service";
import { updateAssetSchema } from "@/modules/assets/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { idParamsSchema, parseBody, parseParams } from "@/server/validation";

type Context = { params: Promise<{ id: string }> };

/** Detail aset. Izin: assets.register.read */
export const GET = apiHandler(async (_request: Request, context: Context) => {
  const actor = await requireActor();
  const { id } = await parseParams(context.params, idParamsSchema);
  return NextResponse.json({ data: await getAsset(actor, id) });
});

/** Ubah aset / status / nonaktifkan. Izin: assets.register.manage */
export const PATCH = apiHandler(async (request: Request, context: Context) => {
  const actor = await requireActor();
  const { id } = await parseParams(context.params, idParamsSchema);
  const input = await parseBody(request, updateAssetSchema);
  return NextResponse.json({ data: await updateAsset(actor, id, input) });
});
