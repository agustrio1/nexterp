import { NextResponse } from "next/server";

import { listAttendance, recordAttendance } from "@/modules/hr/attendance-service";
import { listAttendanceQuerySchema, recordAttendanceSchema } from "@/modules/hr/schemas";
import { readJson } from "@/app/api/hr/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/** Daftar absensi, filter ?employeeId/&from&to. Izin: hr.attendance.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = listAttendanceQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return NextResponse.json({ data: await listAttendance(actor, query) });
});

/** Catat/ubah absensi harian (upsert employee + tanggal). Izin: hr.attendance.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const input = recordAttendanceSchema.parse(await readJson(request));
  return NextResponse.json({ data: await recordAttendance(actor, input) }, { status: 201 });
});
