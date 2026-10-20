import { NextResponse } from "next/server";

import { createRun, listRuns } from "@/modules/assets/depreciation-run-service";
import { createRunSchema, listRunsQuery } from "@/modules/assets/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { parseBody, parseQuery } from "@/server/validation";

/** Daftar run penyusutan. ?periodId=&status=. Izin: assets.depreciation.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = parseQuery(request, listRunsQuery);
  return NextResponse.json({ data: await listRuns(actor, query) });
});

/** Buat run penyusutan (draf) untuk satu periode akuntansi. Izin: assets.depreciation.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const input = await parseBody(request, createRunSchema);
  return NextResponse.json({ data: await createRun(actor, input) }, { status: 201 });
});
