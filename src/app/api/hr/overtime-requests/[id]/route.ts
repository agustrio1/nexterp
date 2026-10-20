import { z } from "zod";
import { NextResponse } from "next/server";

import { approveOvertime, rejectOvertime, submitOvertime } from "@/modules/hr/overtime-service";
import { readId, readJson } from "@/app/api/hr/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

type Ctx = { params: Promise<{ id: string }> };

const actionSchema = z.strictObject({
  action: z.enum(["submit", "approve", "reject"]),
  approverId: z.uuid().optional(),
});

/** Transisi pengajuan lembur: submit | approve | reject. Izin: hr.overtime.manage */
export const POST = apiHandler(async (request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Pengajuan lembur");
  const { action, approverId } = actionSchema.parse(await readJson(request));

  switch (action) {
    case "submit":
      return NextResponse.json({ data: await submitOvertime(actor, id) });
    case "approve":
      return NextResponse.json({ data: await approveOvertime(actor, id, { approverId }) });
    case "reject":
      return NextResponse.json({ data: await rejectOvertime(actor, id, { approverId }) });
  }
});
