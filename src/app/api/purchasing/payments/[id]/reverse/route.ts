import { NextResponse } from "next/server";
import { z } from "zod";

import { reverseApPayment } from "@/modules/purchasing/ap-payment-service";
import { apReasonSchema } from "@/modules/purchasing/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/**
 * Reversal pembayaran posted: membalik jurnal Dr AP/Cr Bank (reverseJournal),
 * hapus alokasi agar invoice kembali terbuka, status reversed.
 * Izin: purchasing.payments.post
 */
export const POST = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Pembayaran AP tidak ditemukan.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = apReasonSchema.parse(body);
  const data = await reverseApPayment(actor, parsed.data, input);
  return NextResponse.json({ data });
});
