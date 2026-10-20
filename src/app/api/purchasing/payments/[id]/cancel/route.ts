import { NextResponse } from "next/server";
import { z } from "zod";

import { cancelApPayment } from "@/modules/purchasing/ap-payment-service";
import { apReasonSchema } from "@/modules/purchasing/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/**
 * Membatalkan pembayaran draft (belum menyentuh buku besar). Izin: purchasing.payments.manage
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
  const data = await cancelApPayment(actor, parsed.data, input);
  return NextResponse.json({ data });
});
