import { NextResponse } from "next/server";

import { createProject, listProjects } from "@/modules/projects/project-service";
import { createProjectSchema, listProjectsQuery } from "@/modules/projects/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { parseBody, parseQuery } from "@/server/validation";

/** Daftar proyek. ?status=&branchId=&isActive=. Izin: projects.master.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = parseQuery(request, listProjectsQuery);
  return NextResponse.json({ data: await listProjects(actor, query) });
});

/** Buat proyek (+ taut/buat cost center 1:1). Izin: projects.master.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const input = await parseBody(request, createProjectSchema);
  return NextResponse.json({ data: await createProject(actor, input) }, { status: 201 });
});
