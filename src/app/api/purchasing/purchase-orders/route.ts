import { NextResponse } from "next/server";

import {
  createPurchaseOrder,
  listPurchaseOrders,
} from "@/modules/purchasing/po-service";
import {
  createPurchaseOrderSchema,
  listPurchaseOrdersQuerySchema,
} from "@/modules/purchasing/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/**
 * Daftar purchase order (terbaru dulu).
 * Filter: ?status, ?supplierId, ?branchId. Izin: purchasing.purchase_orders.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = listPurchaseOrdersQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await listPurchaseOrders(actor, query);
  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});

/** Membuat PO berstatus draft. Izin: purchasing.purchase_orders.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = createPurchaseOrderSchema.parse(body);
  const data = await createPurchaseOrder(actor, input);
  return NextResponse.json({ data }, { status: 201 });
});
