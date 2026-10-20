import { NextResponse } from "next/server";

import {
  createPaymentTerm,
  listPaymentTerms,
} from "@/modules/purchasing/payment-terms-service";
import {
  createPaymentTermSchema,
  listPaymentTermsQuerySchema,
} from "@/modules/purchasing/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/** Daftar termin pembayaran. Izin: purchasing.payment_terms.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = listPaymentTermsQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await listPaymentTerms(actor, query);
  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});

/** Membuat termin pembayaran. Izin: purchasing.payment_terms.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = createPaymentTermSchema.parse(body);
  const data = await createPaymentTerm(actor, input);
  return NextResponse.json({ data }, { status: 201 });
});
