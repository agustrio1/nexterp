import { NextResponse } from "next/server";

import { createAssignment, listAssignments } from "@/modules/projects/assignment-service";
import { createAssignmentSchema } from "@/modules/projects/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { idParamsSchema, parseBody, parseParams } from "@/server/validation";

type Context = { params: Promise<{ id: string }> };

/** Daftar penugasan proyek. Izin: projects.master.read */
export const GET = apiHandler(async (_request: Request, context: Context) => {
  const actor = await requireActor();
  const { id } = await parseParams(context.params, idParamsSchema);
  return NextResponse.json({ data: await listAssignments(actor, id) });
});

/** Tugaskan karyawan ke proyek (peran). Izin: projects.assignments.manage */
export const POST = apiHandler(async (request: Request, context: Context) => {
  const actor = await requireActor();
  const { id } = await parseParams(context.params, idParamsSchema);
  const input = await parseBody(request, createAssignmentSchema);
  return NextResponse.json({ data: await createAssignment(actor, id, input) }, { status: 201 });
});
