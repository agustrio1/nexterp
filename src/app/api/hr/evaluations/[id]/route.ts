import { NextResponse } from "next/server";

import { updateEvaluation } from "@/modules/hr/evaluation-service";
import { updateEvaluationSchema } from "@/modules/hr/schemas";
import { readId, readJson } from "@/app/api/hr/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

type Ctx = { params: Promise<{ id: string }> };

/** Ubah evaluasi. Izin: hr.evaluations.manage */
export const PATCH = apiHandler(async (request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Evaluasi");
  const input = updateEvaluationSchema.parse(await readJson(request));
  return NextResponse.json({ data: await updateEvaluation(actor, id, input) });
});
