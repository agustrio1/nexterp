import { NextResponse } from "next/server";
import { z } from "zod";

import { getSupplierInvoice, updateSupplierInvoice } from "@/modules/purchasing/invoice-service";
import { updateSupplierInvoiceSchema } from "@/modules/purchasing/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

async function parseId(context: IdContext): Promise<string> {
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Invoice pemasok tidak ditemukan.");
  return parsed.data;
}

/** Detail invoice pemasok (header + baris). Izin: purchasing.invoices.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  const data = await getSupplierInvoice(actor, id);
  return NextResponse.json({ data });
});

/** Mengubah invoice draft (pengisian ulang baris). Izin: purchasing.invoices.manage */
export const PATCH = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = updateSupplierInvoiceSchema.parse(body);
  const data = await updateSupplierInvoice(actor, id, input);
  return NextResponse.json({ data });
});
