import { NextResponse } from "next/server";

import { listCompensations, setCompensation } from "@/modules/payroll/compensation-service";
import { setCompensationSchema } from "@/modules/payroll/schemas";
import { readJson, readUuidParam } from "@/app/api/payroll/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/** Daftar riwayat gaji pokok karyawan. WAJIB ?employeeId=. Izin: payroll.structures.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const employeeId = readUuidParam(new URL(request.url).searchParams.get("employeeId"));
  if (!employeeId) throw validationFailed([{ path: "employeeId", message: "Query employeeId wajib." }]);
  return NextResponse.json({ data: await listCompensations(actor, employeeId) });
});

/** Pasang/timpa gaji pokok berlaku-tanggal. Izin: payroll.structures.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const input = setCompensationSchema.parse(await readJson(request));
  return NextResponse.json({ data: await setCompensation(actor, input) }, { status: 201 });
});
