import { z } from "zod";
import { NextResponse } from "next/server";

import { createEvaluation, listEvaluations } from "@/modules/hr/evaluation-service";
import { createEvaluationSchema } from "@/modules/hr/schemas";
import { readJson } from "@/app/api/hr/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/** Daftar evaluasi, opsional ?employeeId=<uuid>. Izin: hr.evaluations.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const raw = new URL(request.url).searchParams.get("employeeId");
  const employeeId = raw ? z.uuid().parse(raw) : undefined;
  return NextResponse.json({ data: await listEvaluations(actor, employeeId) });
});

/** Buat evaluasi (draf). Izin: hr.evaluations.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const input = createEvaluationSchema.parse(await readJson(request));
  return NextResponse.json({ data: await createEvaluation(actor, input) }, { status: 201 });
});
