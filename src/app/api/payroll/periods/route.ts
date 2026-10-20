import { z } from "zod";
import { NextResponse } from "next/server";

import { createPeriod, listPeriods } from "@/modules/payroll/period-service";
import { createPeriodSchema } from "@/modules/payroll/schemas";
import { readJson } from "@/app/api/payroll/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/** Daftar periode payroll. ?status=. Izin: payroll.periods.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const statusRaw = new URL(request.url).searchParams.get("status");
  const status = statusRaw
    ? z.enum(["draft", "finalized", "posted", "closed"]).parse(statusRaw)
    : undefined;
  return NextResponse.json({ data: await listPeriods(actor, { status }) });
});

/** Buat periode payroll (draft). Izin: payroll.periods.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const input = createPeriodSchema.parse(await readJson(request));
  return NextResponse.json({ data: await createPeriod(actor, input) }, { status: 201 });
});
