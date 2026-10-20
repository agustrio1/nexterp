import { z } from "zod";
import { NextResponse } from "next/server";

import {
  approveLeaveRequest,
  cancelLeaveRequest,
  getLeaveRequest,
  rejectLeaveRequest,
  submitLeaveRequest,
} from "@/modules/hr/leave-service";
import { readId, readJson } from "@/app/api/hr/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

type Ctx = { params: Promise<{ id: string }> };

const actionSchema = z.strictObject({
  action: z.enum(["submit", "approve", "reject", "cancel"]),
  approverId: z.uuid().optional(),
});

/** Detail pengajuan cuti. Izin: hr.leaves.read */
export const GET = apiHandler(async (_request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Pengajuan cuti");
  return NextResponse.json({ data: await getLeaveRequest(actor, id) });
});

/** Transisi status: submit | approve | reject | cancel. Izin: hr.leaves.manage */
export const POST = apiHandler(async (request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Pengajuan cuti");
  const { action, approverId } = actionSchema.parse(await readJson(request));

  switch (action) {
    case "submit":
      return NextResponse.json({ data: await submitLeaveRequest(actor, id) });
    case "approve":
      return NextResponse.json({ data: await approveLeaveRequest(actor, id, { approverId }) });
    case "reject":
      return NextResponse.json({ data: await rejectLeaveRequest(actor, id, { approverId }) });
    case "cancel":
      return NextResponse.json({ data: await cancelLeaveRequest(actor, id) });
  }
});
