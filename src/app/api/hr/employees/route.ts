import { NextResponse } from "next/server";

import { createEmployee, listEmployees } from "@/modules/hr/employee-service";
import { createEmployeeSchema, listEmployeesQuerySchema } from "@/modules/hr/schemas";
import { readJson } from "@/app/api/hr/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/** Daftar karyawan. Izin: hr.employees.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = listEmployeesQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return NextResponse.json({ data: await listEmployees(actor, query) });
});

/** Buat karyawan. Izin: hr.employees.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const input = createEmployeeSchema.parse(await readJson(request));
  return NextResponse.json({ data: await createEmployee(actor, input) }, { status: 201 });
});
