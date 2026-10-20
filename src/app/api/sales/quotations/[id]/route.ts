import { NextResponse } from "next/server";
import { z } from "zod";

import { getQuotation, updateQuotation } from "@/modules/sales/quotation-service";
import { updateQuotationSchema } from "@/modules/sales/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

async function parseId(context: IdContext): Promise<string> {
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Penawaran tidak ditemukan.");
  return parsed.data;
}

/** Detail quotation. Izin: sales.quotations.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  const data = await getQuotation(actor, id);
  return NextResponse.json({ data });
});

/** Ubah quotation (draft). Izin: sales.quotations.manage */
export const PATCH = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  let body: unknown;
  try { body = await request.json(); } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = updateQuotationSchema.parse(body);
  const data = await updateQuotation(actor, id, input);
  return NextResponse.json({ data });
});
