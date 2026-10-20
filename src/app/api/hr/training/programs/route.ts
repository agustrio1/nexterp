import { NextResponse } from "next/server";

import { createProgram, listPrograms } from "@/modules/hr/training-service";
import { createTrainingProgramSchema } from "@/modules/hr/schemas";
import { readJson } from "@/app/api/hr/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/** Daftar program pelatihan. Izin: hr.training.read */
export const GET = apiHandler(async () => {
  const actor = await requireActor();
  return NextResponse.json({ data: await listPrograms(actor) });
});

/** Buat program pelatihan. Izin: hr.training.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const input = createTrainingProgramSchema.parse(await readJson(request));
  return NextResponse.json({ data: await createProgram(actor, input) }, { status: 201 });
});
