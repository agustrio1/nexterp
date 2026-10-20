import { z } from "zod";
import { NextResponse } from "next/server";

import { createOvertime, listOvertime } from "@/modules/hr/overtime-service";
import { createOvertimeSchema } from "@/modules/hr/schemas";
import { readJson } from "@/app/api/hr/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/** Daftar pengajuan lembur, opsional ?employeeId=<uuid>. Izin: hr.overtime.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const raw = new URL(request.url).searchParams.get("employeeId");
  const employeeId = raw ? z.uuid().parse(raw) : undefined;
  return NextResponse.json({ data: await listOvertime(actor, employeeId) });
});

/** Buat pengajuan lembur (draf). Izin: hr.overtime.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const input = createOvertimeSchema.parse(await readJson(request));
  return NextResponse.json({ data: await createOvertime(actor, input) }, { status: 201 });
});
