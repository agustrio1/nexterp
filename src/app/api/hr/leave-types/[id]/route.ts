import { NextResponse } from "next/server";

import { updateLeaveType } from "@/modules/hr/leave-service";
import { updateLeaveTypeSchema } from "@/modules/hr/schemas";
import { readId, readJson } from "@/app/api/hr/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

type Ctx = { params: Promise<{ id: string }> };

/** Ubah jenis cuti. Izin: hr.leaves.manage */
export const PATCH = apiHandler(async (request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Jenis cuti");
  const input = updateLeaveTypeSchema.parse(await readJson(request));
  return NextResponse.json({ data: await updateLeaveType(actor, id, input) });
});
