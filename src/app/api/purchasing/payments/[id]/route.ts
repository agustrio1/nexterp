import { NextResponse } from "next/server";
import { z } from "zod";

import { getApPayment } from "@/modules/purchasing/ap-payment-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/** Detail pembayaran AP (header + alokasi). Izin: purchasing.payments.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Pembayaran AP tidak ditemukan.");

  const data = await getApPayment(actor, parsed.data);
  return NextResponse.json({ data });
});
