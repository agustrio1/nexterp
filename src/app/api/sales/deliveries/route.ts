import { NextResponse } from "next/server";

import { createDelivery, listDeliveries } from "@/modules/sales/delivery-service";
import { createDeliverySchema, listSalesQuerySchema } from "@/modules/sales/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/** Daftar pengiriman barang, opsional ?status=&customerId=&branchId=. Izin: sales.deliveries.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = listSalesQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const data = await listDeliveries(actor, query);
  return NextResponse.json({ data });
});

/** Membuat surat jalan / delivery baru (draft). Izin: sales.deliveries.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  let body: unknown;
  try { body = await request.json(); } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = createDeliverySchema.parse(body);
  const data = await createDelivery(actor, input);
  return NextResponse.json({ data }, { status: 201 });
});
