import { NextResponse } from "next/server";
import { z } from "zod";

import { getCustomer, updateCustomer } from "@/modules/crm/customer-service";
import { updateCustomerSchema } from "@/modules/crm/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

async function parseId(context: IdContext): Promise<string> {
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Pelanggan tidak ditemukan.");
  return parsed.data;
}

/** Detail pelanggan. Izin: crm.customers.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  const data = await getCustomer(actor, id);
  return NextResponse.json({ data });
});

/** Ubah pelanggan. Izin: crm.customers.manage */
export const PATCH = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  let body: unknown;
  try { body = await request.json(); } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = updateCustomerSchema.parse(body);
  const data = await updateCustomer(actor, id, input);
  return NextResponse.json({ data });
});
