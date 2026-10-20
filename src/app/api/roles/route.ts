import { NextResponse } from "next/server";

import { createRoleSchema } from "@/modules/roles/schemas";
import { createRole, listRoles } from "@/modules/roles/service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/** Daftar role beserta jumlah permission dan jumlah pengguna. Izin: core.roles.read */
export const GET = apiHandler(async () => {
  const actor = await requireActor();
  const data = await listRoles(actor);

  return NextResponse.json({ data });
});

/** Membuat role baru. Izin: core.roles.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  // ZodError dari parse() otomatis menjadi 422 VALIDATION_FAILED oleh apiHandler.
  const input = createRoleSchema.parse(body);
  const role = await createRole(actor, input);

  return NextResponse.json({ data: role }, { status: 201 });
});