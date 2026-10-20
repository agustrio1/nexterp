import { NextResponse } from "next/server";
import { z } from "zod";

import { getDepartment, updateDepartment } from "@/modules/organization/department-service";
import { updateDepartmentSchema } from "@/modules/organization/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };

const idSchema = z.uuid();

async function parseDepartmentId(context: IdContext): Promise<string> {
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);

  // Format id yang salah diperlakukan sebagai tidak ditemukan, bukan 500 dari database.
  if (!parsed.success) {
    throw notFound("Departemen tidak ditemukan.");
  }
  return parsed.data;
}

/** Detail departemen. Izin: core.departments.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseDepartmentId(context);

  const department = await getDepartment(actor, id);
  return NextResponse.json({ data: department });
});

/**
 * Mengubah nama, induk, cabang, dan/atau status aktif. Izin: core.departments.manage
 * Kode departemen tidak bisa diubah. Tidak ada DELETE: departemen hanya dinonaktifkan.
 */
export const PATCH = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseDepartmentId(context);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = updateDepartmentSchema.parse(body);
  const department = await updateDepartment(actor, id, input);

  return NextResponse.json({ data: department });
});