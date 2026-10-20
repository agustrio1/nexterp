import { z } from "zod";
import { NextResponse } from "next/server";

import { createLeaveRequest, listLeaveRequests } from "@/modules/hr/leave-service";
import { createLeaveRequestSchema } from "@/modules/hr/schemas";
import { readJson } from "@/app/api/hr/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/** Daftar pengajuan cuti, opsional ?employeeId=<uuid>. Izin: hr.leaves.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const raw = new URL(request.url).searchParams.get("employeeId");
  const employeeId = raw ? z.uuid().parse(raw) : undefined;
  return NextResponse.json({ data: await listLeaveRequests(actor, employeeId) });
});

/** Buat pengajuan cuti (draf). Izin: hr.leaves.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const input = createLeaveRequestSchema.parse(await readJson(request));
  return NextResponse.json({ data: await createLeaveRequest(actor, input) }, { status: 201 });
});
