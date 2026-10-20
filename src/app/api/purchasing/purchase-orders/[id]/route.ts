import { NextResponse } from "next/server";
import { z } from "zod";

import { getPurchaseOrder, updatePurchaseOrder } from "@/modules/purchasing/po-service";
import { updatePurchaseOrderSchema } from "@/modules/purchasing/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

async function parseId(context: IdContext): Promise<string> {
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Purchase order tidak ditemukan.");
  return parsed.data;
}

/** Detail purchase order (header + baris). Izin: purchasing.purchase_orders.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  const data = await getPurchaseOrder(actor, id);
  return NextResponse.json({ data });
});

/** Mengubah PO draft (pengisian ulang baris). Izin: purchasing.purchase_orders.manage */
export const PATCH = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = updatePurchaseOrderSchema.parse(body);
  const data = await updatePurchaseOrder(actor, id, input);
  return NextResponse.json({ data });
});
