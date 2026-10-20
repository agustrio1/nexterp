import { NextResponse } from "next/server";

import { createDisposal, listDisposals } from "@/modules/assets/disposal-service";
import { createDisposalSchema, listDisposalsQuery } from "@/modules/assets/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { parseBody, parseQuery } from "@/server/validation";

/** Daftar pelepasan. ?assetId=&status=. Izin: assets.disposal.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = parseQuery(request, listDisposalsQuery);
  return NextResponse.json({ data: await listDisposals(actor, query) });
});

/** Buat pelepasan (draf). Izin: assets.disposal.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const input = await parseBody(request, createDisposalSchema);
  return NextResponse.json({ data: await createDisposal(actor, input) }, { status: 201 });
});
