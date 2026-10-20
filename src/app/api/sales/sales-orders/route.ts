import { NextResponse } from "next/server";

import { createSalesOrder, listSalesOrders } from "@/modules/sales/so-service";
import { createSalesOrderSchema, listSalesQuerySchema } from "@/modules/sales/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/** Daftar sales order, opsional ?status=&customerId=&branchId=. Izin: sales.orders.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = listSalesQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const data = await listSalesOrders(actor, query);
  return NextResponse.json({ data });
});

/** Membuat sales order baru. Izin: sales.orders.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  let body: unknown;
  try { body = await request.json(); } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = createSalesOrderSchema.parse(body);
  const data = await createSalesOrder(actor, input);
  return NextResponse.json({ data }, { status: 201 });
});
