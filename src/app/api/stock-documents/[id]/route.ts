import { NextResponse } from "next/server";
import { z } from "zod";

import { getStockDocument } from "@/modules/inventory/document-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/** Detail dokumen stok (header + baris). Izin: inventory.documents.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Dokumen stok tidak ditemukan.");

  const data = await getStockDocument(actor, parsed.data);
  return NextResponse.json({ data });
});
