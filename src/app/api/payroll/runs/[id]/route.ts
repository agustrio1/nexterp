import { NextResponse } from "next/server";

import { getRun } from "@/modules/payroll/run-service";
import { readId } from "@/app/api/payroll/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

type Ctx = { params: Promise<{ id: string }> };

/** Detail run + item + rincian komponen. Izin: payroll.runs.read */
export const GET = apiHandler(async (_request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Run");
  return NextResponse.json({ data: await getRun(actor, id) });
});
