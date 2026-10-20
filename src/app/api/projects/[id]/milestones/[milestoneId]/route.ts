import { NextResponse } from "next/server";
import { z } from "zod";

import { updateMilestone } from "@/modules/projects/task-service";
import { updateMilestoneSchema } from "@/modules/projects/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { parseBody, parseParams } from "@/server/validation";

const paramsSchema = z.object({
  id: z.uuid("ID tidak valid."),
  milestoneId: z.uuid("ID tidak valid."),
});

type Context = { params: Promise<{ id: string; milestoneId: string }> };

/** Ubah milestone (isCompleted true mengisi completedAt). Izin: projects.tasks.manage */
export const PATCH = apiHandler(async (request: Request, context: Context) => {
  const actor = await requireActor();
  const { milestoneId } = await parseParams(context.params, paramsSchema);
  const input = await parseBody(request, updateMilestoneSchema);
  return NextResponse.json({ data: await updateMilestone(actor, milestoneId, input) });
});
