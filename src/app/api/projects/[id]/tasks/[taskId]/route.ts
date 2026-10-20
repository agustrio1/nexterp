import { NextResponse } from "next/server";
import { z } from "zod";

import { updateTask } from "@/modules/projects/task-service";
import { updateTaskSchema } from "@/modules/projects/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { parseBody, parseParams } from "@/server/validation";

const paramsSchema = z.object({ id: z.uuid("ID tidak valid."), taskId: z.uuid("ID tidak valid.") });

type Context = { params: Promise<{ id: string; taskId: string }> };

/** Ubah tugas / transisi status (completed mengisi completedAt). Izin: projects.tasks.manage */
export const PATCH = apiHandler(async (request: Request, context: Context) => {
  const actor = await requireActor();
  const { taskId } = await parseParams(context.params, paramsSchema);
  const input = await parseBody(request, updateTaskSchema);
  return NextResponse.json({ data: await updateTask(actor, taskId, input) });
});
