import { NextResponse } from "next/server";
import { z } from "zod";

import { postApPayment } from "@/modules/purchasing/ap-payment-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/**
 * Memosting pembayaran: snapshot kurs, alokasi FIFO ke invoice terbuka, terbitkan
 * jurnal Dr AP / Cr Bank, nomor dokumen, status posted. Izin: purchasing.payments.post
 */
export const POST = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Pembayaran AP tidak ditemukan.");

  const data = await postApPayment(actor, parsed.data);
  return NextResponse.json({ data });
});
