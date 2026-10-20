import { NextResponse } from "next/server";
import { z } from "zod";

import { updateRoleSchema } from "@/modules/roles/schemas";
import { deleteRole, getRole, updateRole } from "@/modules/roles/service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };

const idSchema = z.uuid();

async function parseRoleId(context: IdContext): Promise<string> {
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);

  // Format id yang salah diperlakukan sebagai tidak ditemukan, bukan 500 dari database.
  if (!parsed.success) {
    throw notFound("Role tidak ditemukan.");
  }
  return parsed.data;
}

/** Detail role beserta daftar permission-nya. Izin: core.roles.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseRoleId(context);

  const role = await getRole(actor, id);
  return NextResponse.json({ data: role });
});

/**
 * Mengubah nama, deskripsi, dan/atau permission role. Izin: core.roles.manage
 * permissionCodes, bila dikirim, MENGGANTI seluruh permission role.
 */
export const PATCH = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseRoleId(context);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = updateRoleSchema.parse(body);
  const role = await updateRole(actor, id, input);

  return NextResponse.json({ data: role });
});

/** Menghapus role yang tidak dipakai pengguna mana pun. Izin: core.roles.manage */
export const DELETE = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseRoleId(context);

  await deleteRole(actor, id);
  return new NextResponse(null, { status: 204 });
});