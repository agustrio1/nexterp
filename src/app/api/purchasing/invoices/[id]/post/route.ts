import { NextResponse } from "next/server";
import { z } from "zod";

import { postSupplierInvoice } from "@/modules/purchasing/invoice-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/**
 * Memosting invoice: snapshot kurs, isi amountBase/totalBase, terbitkan jurnal
 * GR/IR perpetual (Dr GR/IR / Cr AP), nomor dokumen, status posted.
 * Izin: purchasing.invoices.post
 */
export const POST = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Invoice pemasok tidak ditemukan.");

  const data = await postSupplierInvoice(actor, parsed.data);
  return NextResponse.json({ data });
});
