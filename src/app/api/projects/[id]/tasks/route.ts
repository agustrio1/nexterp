import { NextResponse } from "next/server";

import { createTask, listTasks } from "@/modules/projects/task-service";
import { createTaskSchema } from "@/modules/projects/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { idParamsSchema, parseBody, parseParams } from "@/server/validation";

type Context = { params: Promise<{ id: string }> };

/** Daftar tugas proyek. Izin: projects.tasks.read */
export const GET = apiHandler(async (_request: Request, context: Context) => {
  const actor = await requireActor();
  const { id } = await parseParams(context.params, idParamsSchema);
  return NextResponse.json({ data: await listTasks(actor, id) });
});

/** Buat tugas. Izin: projects.tasks.manage */
export const POST = apiHandler(async (request: Request, context: Context) => {
  const actor = await requireActor();
  const { id } = await parseParams(context.params, idParamsSchema);
  const input = await parseBody(request, createTaskSchema);
  return NextResponse.json({ data: await createTask(actor, id, input) }, { status: 201 });
});
