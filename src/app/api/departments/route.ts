import { NextResponse } from "next/server";

import {
  createDepartment,
  listDepartments,
} from "@/modules/organization/department-service";
import {
  createDepartmentSchema,
  listDepartmentsQuerySchema,
} from "@/modules/organization/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/**
 * Daftar departemen (datar), opsional ?isActive=true|false dan ?branchId=<uuid>.
 * Izin: core.departments.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = listDepartmentsQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await listDepartments(actor, query);

  return NextResponse.json({ data });
});

/** Membuat departemen baru. Izin: core.departments.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = createDepartmentSchema.parse(body);
  const department = await createDepartment(actor, input);

  return NextResponse.json({ data: department }, { status: 201 });
});