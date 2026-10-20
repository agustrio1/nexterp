import { NextResponse } from "next/server";
import { z } from "zod";

import { postStockDocument } from "@/modules/inventory/document-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/**
 * Memposting dokumen stok: menghasilkan pergerakan ledger (via mesin FIFO 5C) untuk
 * tiap baris, mengisi nomor dokumen sesuai jenis, dan menandai status posted.
 * Hanya draf yang dapat diposting. Izin: inventory.documents.manage
 */
export const POST = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Dokumen stok tidak ditemukan.");

  const data = await postStockDocument(actor, parsed.data);
  return NextResponse.json({ data });
});
