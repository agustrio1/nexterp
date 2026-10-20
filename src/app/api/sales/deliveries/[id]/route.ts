import { NextResponse } from "next/server";
import { z } from "zod";

import { getDelivery } from "@/modules/sales/delivery-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/** Detail pengiriman barang. Izin: sales.deliveries.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) throw notFound("Pengiriman tidak ditemukan.");
  const data = await getDelivery(actor, id);
  return NextResponse.json({ data });
});
