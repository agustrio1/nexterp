import { NextResponse } from "next/server";
import { z } from "zod";

import { createReceiptFromPo } from "@/modules/purchasing/gr-from-po-service";
import { createReceiptFromPoSchema } from "@/modules/purchasing/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/**
 * Menerima barang dari PO posted (goods receipt). Membuat + memosting dokumen
 * penerimaan pada mesin stok dan menaikkan quantityReceived baris PO.
 * Izin: purchasing.receipts.manage (+ inventory.documents.manage karena memakai engine 5D)
 */
export const POST = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Purchase order tidak ditemukan.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = createReceiptFromPoSchema.parse(body);
  const data = await createReceiptFromPo(actor, parsed.data, input);
  return NextResponse.json({ data }, { status: 201 });
});
