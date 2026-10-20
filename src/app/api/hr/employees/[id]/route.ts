import { NextResponse } from "next/server";

import { getEmployee, updateEmployee } from "@/modules/hr/employee-service";
import { updateEmployeeSchema } from "@/modules/hr/schemas";
import { readId, readJson } from "@/app/api/hr/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

type Ctx = { params: Promise<{ id: string }> };

/** Detail karyawan. Izin: hr.employees.read */
export const GET = apiHandler(async (_request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Karyawan");
  return NextResponse.json({ data: await getEmployee(actor, id) });
});

/** Ubah karyawan (termasuk isActive/status; userId: null melepas tautan login). Izin: hr.employees.manage */
export const PATCH = apiHandler(async (request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Karyawan");
  const input = updateEmployeeSchema.parse(await readJson(request));
  return NextResponse.json({ data: await updateEmployee(actor, id, input) });
});
