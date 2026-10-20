import { NextResponse } from "next/server";
import { z } from "zod";

import { convertLead } from "@/modules/crm/lead-service";
import { convertLeadSchema } from "@/modules/crm/schemas";
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

/** Konversi lead menjadi akun CRM + kontak. Izin: crm.leads.manage */
export const POST = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  let body: unknown;
  try { body = await request.json(); } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = convertLeadSchema.parse(body);
  const data = await convertLead(actor, id, input);
  return NextResponse.json({ data });
});
