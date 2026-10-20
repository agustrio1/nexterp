import { NextResponse } from "next/server";

import { updateProgram } from "@/modules/hr/training-service";
import { updateTrainingProgramSchema } from "@/modules/hr/schemas";
import { readId, readJson } from "@/app/api/hr/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

type Ctx = { params: Promise<{ id: string }> };

/** Ubah program pelatihan. Izin: hr.training.manage */
export const PATCH = apiHandler(async (request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Program pelatihan");
  const input = updateTrainingProgramSchema.parse(await readJson(request));
  return NextResponse.json({ data: await updateProgram(actor, id, input) });
});
