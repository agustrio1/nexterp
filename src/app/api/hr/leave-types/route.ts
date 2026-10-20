import { NextResponse } from "next/server";

import { createLeaveType, listLeaveTypes } from "@/modules/hr/leave-service";
import { createLeaveTypeSchema } from "@/modules/hr/schemas";
import { readJson } from "@/app/api/hr/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/** Daftar jenis cuti. Izin: hr.leaves.read */
export const GET = apiHandler(async () => {
  const actor = await requireActor();
  return NextResponse.json({ data: await listLeaveTypes(actor) });
});

/** Buat jenis cuti. Izin: hr.leaves.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const input = createLeaveTypeSchema.parse(await readJson(request));
  return NextResponse.json({ data: await createLeaveType(actor, input) }, { status: 201 });
});
