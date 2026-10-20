import { NextResponse } from "next/server";

import { createApPayment, listApPayments } from "@/modules/purchasing/ap-payment-service";
import { createApPaymentSchema, listApPaymentsQuerySchema } from "@/modules/purchasing/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/**
 * Daftar pembayaran AP. Filter: ?status, ?supplierId. Izin: purchasing.payments.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = listApPaymentsQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await listApPayments(actor, query);
  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});

/** Membuat pembayaran AP draft. Izin: purchasing.payments.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = createApPaymentSchema.parse(body);
  const data = await createApPayment(actor, input);
  return NextResponse.json({ data }, { status: 201 });
});
