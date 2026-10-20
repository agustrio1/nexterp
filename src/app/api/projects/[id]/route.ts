import { NextResponse } from "next/server";

import { getProject, updateProject } from "@/modules/projects/project-service";
import { updateProjectSchema } from "@/modules/projects/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { idParamsSchema, parseBody, parseParams } from "@/server/validation";

type Context = { params: Promise<{ id: string }> };

/** Detail proyek (+ cost center & manager). Izin: projects.master.read */
export const GET = apiHandler(async (_request: Request, context: Context) => {
  const actor = await requireActor();
  const { id } = await parseParams(context.params, idParamsSchema);
  return NextResponse.json({ data: await getProject(actor, id) });
});

/** Ubah proyek (kode & tautan cost center imutabel). Izin: projects.master.manage */
export const PATCH = apiHandler(async (request: Request, context: Context) => {
  const actor = await requireActor();
  const { id } = await parseParams(context.params, idParamsSchema);
  const input = await parseBody(request, updateProjectSchema);
  return NextResponse.json({ data: await updateProject(actor, id, input) });
});
