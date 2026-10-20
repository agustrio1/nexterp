import { NextResponse } from "next/server";

import { createMilestone, listMilestones } from "@/modules/projects/task-service";
import { createMilestoneSchema } from "@/modules/projects/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { idParamsSchema, parseBody, parseParams } from "@/server/validation";

type Context = { params: Promise<{ id: string }> };

/** Daftar milestone proyek. Izin: projects.tasks.read */
export const GET = apiHandler(async (_request: Request, context: Context) => {
  const actor = await requireActor();
  const { id } = await parseParams(context.params, idParamsSchema);
  return NextResponse.json({ data: await listMilestones(actor, id) });
});

/** Buat milestone. Izin: projects.tasks.manage */
export const POST = apiHandler(async (request: Request, context: Context) => {
  const actor = await requireActor();
  const { id } = await parseParams(context.params, idParamsSchema);
  const input = await parseBody(request, createMilestoneSchema);
  return NextResponse.json({ data: await createMilestone(actor, id, input) }, { status: 201 });
});
