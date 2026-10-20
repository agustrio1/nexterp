import { NextResponse } from "next/server";

import { createQuotation, listQuotations } from "@/modules/sales/quotation-service";
import { createQuotationSchema, listSalesQuerySchema } from "@/modules/sales/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/** Daftar quotation, opsional ?status=&customerId=&branchId=. Izin: sales.quotations.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = listSalesQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const data = await listQuotations(actor, query);
  return NextResponse.json({ data });
});

/** Membuat quotation baru. Izin: sales.quotations.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  let body: unknown;
  try { body = await request.json(); } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = createQuotationSchema.parse(body);
  const data = await createQuotation(actor, input);
  return NextResponse.json({ data }, { status: 201 });
});
