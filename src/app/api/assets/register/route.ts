import { NextResponse } from "next/server";

import { createAsset, listAssets } from "@/modules/assets/asset-service";
import { createAssetSchema, listAssetsQuery } from "@/modules/assets/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { parseBody, parseQuery } from "@/server/validation";

/** Daftar aset tetap. ?categoryId=&branchId=&status=&isActive=. Izin: assets.register.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = parseQuery(request, listAssetsQuery);
  const data = await listAssets(actor, query);
  return NextResponse.json({ data });
});

/** Buat aset (register). Izin: assets.register.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const input = await parseBody(request, createAssetSchema);
  const data = await createAsset(actor, input);
  return NextResponse.json({ data }, { status: 201 });
});
