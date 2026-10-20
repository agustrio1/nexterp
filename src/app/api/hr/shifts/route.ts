import { NextResponse } from "next/server";

import { createShift, listShifts } from "@/modules/hr/shift-service";
import { createShiftSchema } from "@/modules/hr/schemas";
import { readJson } from "@/app/api/hr/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/** Daftar shift. Izin: hr.shifts.read */
export const GET = apiHandler(async () => {
  const actor = await requireActor();
  return NextResponse.json({ data: await listShifts(actor) });
});

/** Buat shift. Izin: hr.shifts.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const input = createShiftSchema.parse(await readJson(request));
  return NextResponse.json({ data: await createShift(actor, input) }, { status: 201 });
});
