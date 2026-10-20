import { NextResponse } from "next/server";

import { createPayment, listPayments } from "@/modules/sales/payment-service";
import { createCustomerPaymentSchema, listSalesQuerySchema } from "@/modules/sales/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/** Daftar pembayaran customer, opsional ?status=&customerId=&branchId=. Izin: sales.payments.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = listSalesQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const data = await listPayments(actor, query);
  return NextResponse.json({ data });
});

/** Mencatat pembayaran customer baru (draft). Izin: sales.payments.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  let body: unknown;
  try { body = await request.json(); } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = createCustomerPaymentSchema.parse(body);
  const data = await createPayment(actor, input);
  return NextResponse.json({ data }, { status: 201 });
});
