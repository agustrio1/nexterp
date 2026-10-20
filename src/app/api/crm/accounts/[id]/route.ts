import { NextResponse } from "next/server";
import { z } from "zod";

import { getAccount, updateAccount } from "@/modules/crm/account-service";
import { updateAccountSchema } from "@/modules/crm/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

async function parseId(context: IdContext): Promise<string> {
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Akun CRM tidak ditemukan.");
  return parsed.data;
}

/** Detail akun CRM. Izin: crm.accounts.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  const data = await getAccount(actor, id);
  return NextResponse.json({ data });
});

/** Ubah akun CRM. Izin: crm.accounts.manage */
export const PATCH = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  let body: unknown;
  try { body = await request.json(); } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = updateAccountSchema.parse(body);
  const data = await updateAccount(actor, id, input);
  return NextResponse.json({ data });
});
