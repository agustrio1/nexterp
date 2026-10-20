import { NextResponse } from "next/server";
import { z } from "zod";

import { updateStage } from "@/modules/crm/pipeline-service";
import { updateStageSchema } from "@/modules/crm/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

async function parseId(context: IdContext): Promise<string> {
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Tahap pipeline tidak ditemukan.");
  return parsed.data;
}

/** Ubah tahap pipeline. Izin: crm.pipeline_stages.manage */
export const PATCH = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  let body: unknown;
  try { body = await request.json(); } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = updateStageSchema.parse(body);
  const data = await updateStage(actor, id, input);
  return NextResponse.json({ data });
});
