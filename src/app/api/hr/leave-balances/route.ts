import { z } from "zod";
import { NextResponse } from "next/server";

import { listLeaveBalances, setLeaveBalance } from "@/modules/hr/leave-service";
import { createLeaveBalanceSchema } from "@/modules/hr/schemas";
import { readJson } from "@/app/api/hr/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/** Daftar saldo cuti, opsional ?employeeId=<uuid>. Izin: hr.leaves.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const raw = new URL(request.url).searchParams.get("employeeId");
  const employeeId = raw ? z.uuid().parse(raw) : undefined;
  return NextResponse.json({ data: await listLeaveBalances(actor, employeeId) });
});

/** Tentukan kuota saldo cuti (upsert employee+type+year). Izin: hr.leaves.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const input = createLeaveBalanceSchema.parse(await readJson(request));
  return NextResponse.json({ data: await setLeaveBalance(actor, input) }, { status: 201 });
});
