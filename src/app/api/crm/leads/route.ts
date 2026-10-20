import { NextResponse } from "next/server";

import { createLead, listLeads } from "@/modules/crm/lead-service";
import { createLeadSchema, listQuerySchema } from "@/modules/crm/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/** Daftar lead, opsional ?isActive=&search=. Izin: crm.leads.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = listQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await listLeads(actor, query);
  return NextResponse.json({ data });
});

/** Membuat lead baru. Izin: crm.leads.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  let body: unknown;
  try { body = await request.json(); } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = createLeadSchema.parse(body);
  const data = await createLead(actor, input);
  return NextResponse.json({ data }, { status: 201 });
});
