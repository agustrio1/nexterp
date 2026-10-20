import { NextResponse } from "next/server";
import { z } from "zod";

import { cancelPurchaseOrder } from "@/modules/purchasing/po-service";
import { cancelPurchaseOrderSchema } from "@/modules/purchasing/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/**
 * Membatalkan PO (draft/pending_approval/approved). PO posted tidak dapat dibatalkan.
 * Izin: purchasing.purchase_orders.manage
 */
export const POST = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Purchase order tidak ditemukan.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = cancelPurchaseOrderSchema.parse(body);
  const data = await cancelPurchaseOrder(actor, parsed.data, input);
  return NextResponse.json({ data });
});
