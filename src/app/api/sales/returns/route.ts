import { NextResponse } from "next/server";

import { createReturn, listReturns } from "@/modules/sales/return-service";
import { createSalesReturnSchema, listSalesQuerySchema } from "@/modules/sales/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/** Daftar retur penjualan, opsional ?status=&customerId=&branchId=. Izin: sales.returns.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = listSalesQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const data = await listReturns(actor, query);
  return NextResponse.json({ data });
});

/** Membuat retur penjualan baru (draft) dari pengiriman posted. Izin: sales.returns.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  let body: unknown;
  try { body = await request.json(); } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = createSalesReturnSchema.parse(body);
  const data = await createReturn(actor, input);
  return NextResponse.json({ data }, { status: 201 });
});
