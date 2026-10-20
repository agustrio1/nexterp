import { NextResponse } from "next/server";
import { z } from "zod";

import { createContact, listContacts } from "@/modules/crm/contact-service";
import { createContactSchema } from "@/modules/crm/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

const querySchema = z.object({ accountId: z.uuid() });

/** Daftar kontak untuk akun tertentu ?accountId=<uuid>. Izin: crm.contacts.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const { accountId } = querySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await listContacts(actor, accountId);
  return NextResponse.json({ data });
});

/** Membuat kontak baru. Izin: crm.contacts.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  let body: unknown;
  try { body = await request.json(); } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = createContactSchema.parse(body);
  const data = await createContact(actor, input);
  return NextResponse.json({ data }, { status: 201 });
});
