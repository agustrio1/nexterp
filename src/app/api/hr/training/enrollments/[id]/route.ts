import { NextResponse } from "next/server";

import { updateEnrollment } from "@/modules/hr/training-service";
import { updateEnrollmentSchema } from "@/modules/hr/schemas";
import { readId, readJson } from "@/app/api/hr/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

type Ctx = { params: Promise<{ id: string }> };

/** Ubah status pendaftaran pelatihan. Izin: hr.training.manage */
export const PATCH = apiHandler(async (request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Pendaftaran pelatihan");
  const input = updateEnrollmentSchema.parse(await readJson(request));
  return NextResponse.json({ data: await updateEnrollment(actor, id, input) });
});
