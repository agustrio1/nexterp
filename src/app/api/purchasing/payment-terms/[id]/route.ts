import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getPaymentTerm,
  updatePaymentTerm,
} from "@/modules/purchasing/payment-terms-service";
import { updatePaymentTermSchema } from "@/modules/purchasing/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

async function parseId(context: IdContext): Promise<string> {
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Termin pembayaran tidak ditemukan.");
  return parsed.data;
}

/** Detail termin pembayaran. Izin: purchasing.payment_terms.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  const data = await getPaymentTerm(actor, id);
  return NextResponse.json({ data });
});

/** Mengubah termin pembayaran (nama, dueInDays, isActive). Izin: purchasing.payment_terms.manage */
export const PATCH = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = updatePaymentTermSchema.parse(body);
  const data = await updatePaymentTerm(actor, id, input);
  return NextResponse.json({ data });
});
