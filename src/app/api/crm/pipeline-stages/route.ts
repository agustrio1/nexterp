import { NextResponse } from "next/server";

import { createStage, listStages } from "@/modules/crm/pipeline-service";
import { createStageSchema } from "@/modules/crm/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/** Daftar tahap pipeline. Izin: crm.pipeline_stages.read */
export const GET = apiHandler(async () => {
  const actor = await requireActor();
  const data = await listStages(actor);
  return NextResponse.json({ data });
});

/** Membuat tahap pipeline. Izin: crm.pipeline_stages.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  let body: unknown;
  try { body = await request.json(); } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = createStageSchema.parse(body);
  const data = await createStage(actor, input);
  return NextResponse.json({ data }, { status: 201 });
});
