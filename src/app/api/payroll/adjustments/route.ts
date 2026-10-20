import { NextResponse } from "next/server";

import { createAdjustment, listAdjustments } from "@/modules/payroll/compensation-service";
import { createAdjustmentSchema } from "@/modules/payroll/schemas";
import { readJson, readUuidParam } from "@/app/api/payroll/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/** Daftar penyesuaian. ?employeeId=, ?periodId=. Izin: payroll.adjustments.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const sp = new URL(request.url).searchParams;
  return NextResponse.json({
    data: await listAdjustments(actor, {
      employeeId: readUuidParam(sp.get("employeeId")),
      periodId: readUuidParam(sp.get("periodId")),
    }),
  });
});

/** Buat penyesuaian gaji. Izin: payroll.adjustments.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const input = createAdjustmentSchema.parse(await readJson(request));
  return NextResponse.json({ data: await createAdjustment(actor, input) }, { status: 201 });
});
