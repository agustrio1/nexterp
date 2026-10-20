import { NextResponse } from "next/server";
import { z } from "zod";

import { removeAssignment } from "@/modules/projects/assignment-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { parseParams } from "@/server/validation";

const paramsSchema = z.object({
  id: z.uuid("ID tidak valid."),
  assignmentId: z.uuid("ID tidak valid."),
});

type Context = { params: Promise<{ id: string; assignmentId: string }> };

/** Cabut penugasan. Izin: projects.assignments.manage */
export const DELETE = apiHandler(async (_request: Request, context: Context) => {
  const actor = await requireActor();
  const { id, assignmentId } = await parseParams(context.params, paramsSchema);
  return NextResponse.json({ data: await removeAssignment(actor, id, assignmentId) });
});
