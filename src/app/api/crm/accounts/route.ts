import { NextResponse } from "next/server";

import { createAccount, listAccounts } from "@/modules/crm/account-service";
import { createAccountSchema, listQuerySchema } from "@/modules/crm/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/** Daftar akun CRM, opsional ?isActive=true|false&search=… Izin: crm.accounts.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = listQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await listAccounts(actor, query);
  return NextResponse.json({ data });
});

/** Membuat akun CRM baru. Izin: crm.accounts.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  let body: unknown;
  try { body = await request.json(); } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = createAccountSchema.parse(body);
  const data = await createAccount(actor, input);
  return NextResponse.json({ data }, { status: 201 });
});
