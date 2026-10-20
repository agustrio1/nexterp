import { NextResponse } from "next/server";
import { z } from "zod";

import { approvePurchaseOrder } from "@/modules/purchasing/po-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/**
 * Menyetujui PO pending_approval menjadi approved. Menuntut approval_request
 * (doc_type=purchase_order) berstatus approved dari mesin 3J. Izin: purchasing.purchase_orders.post
 */
export const POST = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Purchase order tidak ditemukan.");

  const data = await approvePurchaseOrder(actor, parsed.data);
  return NextResponse.json({ data });
});
