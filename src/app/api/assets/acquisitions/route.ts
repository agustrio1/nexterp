import { NextResponse } from "next/server";

import { createAcquisition, listAcquisitions } from "@/modules/assets/acquisition-service";
import { createAcquisitionSchema, listAcquisitionsQuery } from "@/modules/assets/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { parseBody, parseQuery } from "@/server/validation";

/** Daftar akuisisi. ?assetId=&status=. Izin: assets.acquisitions.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = parseQuery(request, listAcquisitionsQuery);
  return NextResponse.json({ data: await listAcquisitions(actor, query) });
});

/** Buat akuisisi (draf). Izin: assets.acquisitions.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const input = await parseBody(request, createAcquisitionSchema);
  return NextResponse.json({ data: await createAcquisition(actor, input) }, { status: 201 });
});
