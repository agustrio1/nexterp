import { NextResponse } from "next/server";
import { z } from "zod";

import { postDelivery } from "@/modules/sales/delivery-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/** Posting pengiriman: keluarkan stok, catat jurnal HPP, terbitkan nomor, update qty SO. Izin: sales.deliveries.manage */
export const POST = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) throw notFound("Pengiriman tidak ditemukan.");
  const data = await postDelivery(actor, id);
  return NextResponse.json({ data });
});
