import { NextResponse } from "next/server";
import { z } from "zod";

import { submitPurchaseOrder } from "@/modules/purchasing/po-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/**
 * Mengajukan PO draft ke mesin persetujuan 3J (draft -> pending_approval).
 * Izin: purchasing.purchase_orders.post
 */
export const POST = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Purchase order tidak ditemukan.");

  const data = await submitPurchaseOrder(actor, parsed.data);
  return NextResponse.json({ data });
});
