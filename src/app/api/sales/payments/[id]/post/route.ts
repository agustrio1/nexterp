import { NextResponse } from "next/server";
import { z } from "zod";

import { postPayment } from "@/modules/sales/payment-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/** Posting pembayaran: kunci kurs, alokasi FIFO ke invoice terbuka, jurnal Dr AR / Cr Bank. Izin: sales.payments.post */
export const POST = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) throw notFound("Pembayaran tidak ditemukan.");
  const data = await postPayment(actor, id);
  return NextResponse.json({ data });
});
