import { NextResponse } from "next/server";

import { getJob } from "@/modules/jobs/job-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { idParamsSchema, parseParams } from "@/server/validation";

type Context = { params: Promise<{ id: string }> };

/** Status satu job (tanpa isi artefak). Izin: reporting.exports.read */
export const GET = apiHandler(async (_request: Request, context: Context) => {
  const actor = await requireActor();
  const { id } = await parseParams(context.params, idParamsSchema);
  return NextResponse.json(
    { data: await getJob(actor, id) },
    { headers: { "Cache-Control": "no-store" } },
  );
});
