import { NextResponse } from "next/server";
import { z } from "zod";

import { getLead, updateLead } from "@/modules/crm/lead-service";
import { updateLeadSchema } from "@/modules/crm/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

async function parseId(context: IdContext): Promise<string> {
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Lead tidak ditemukan.");
  return parsed.data;
}

/** Detail lead. Izin: crm.leads.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  const data = await getLead(actor, id);
  return NextResponse.json({ data });
});

/** Ubah lead. Izin: crm.leads.manage */
export const PATCH = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  let body: unknown;
  try { body = await request.json(); } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = updateLeadSchema.parse(body);
  const data = await updateLead(actor, id, input);
  return NextResponse.json({ data });
});
