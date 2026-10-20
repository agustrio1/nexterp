import { NextResponse } from "next/server";
import { z } from "zod";

import { getPayment } from "@/modules/sales/payment-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/** Detail pembayaran customer. Izin: sales.payments.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) throw notFound("Pembayaran tidak ditemukan.");
  const data = await getPayment(actor, id);
  return NextResponse.json({ data });
});
