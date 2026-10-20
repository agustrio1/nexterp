import { NextResponse } from "next/server";
import { z } from "zod";

import { reversePayment } from "@/modules/sales/payment-service";
import { cancelDocSchema } from "@/modules/sales/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/** Reverse pembayaran posted: hapus alokasi, kurangi amountPaid, reverse jurnal. Izin: sales.payments.post */
export const POST = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) throw notFound("Pembayaran tidak ditemukan.");
  let body: unknown;
  try { body = await request.json(); } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = cancelDocSchema.parse(body);
  const data = await reversePayment(actor, id, input.reason);
  return NextResponse.json({ data });
});
