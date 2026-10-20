import { NextResponse } from "next/server";
import { z } from "zod";

import { removePriceItem } from "@/modules/crm/price-list-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound } from "@/server/errors";

type ItemContext = { params: Promise<{ id: string; productId: string }> };
const uuidSchema = z.uuid();

async function parseParams(context: ItemContext): Promise<{ id: string; productId: string }> {
  const { id, productId } = await context.params;
  const parsedId = uuidSchema.safeParse(id);
  const parsedProductId = uuidSchema.safeParse(productId);
  if (!parsedId.success || !parsedProductId.success) {
    throw notFound("Item daftar harga tidak ditemukan.");
  }
  return { id: parsedId.data, productId: parsedProductId.data };
}

/** Hapus item dari price list. Izin: crm.price_lists.manage */
export const DELETE = apiHandler(async (_request: Request, context: ItemContext) => {
  const actor = await requireActor();
  const { id, productId } = await parseParams(context);
  await removePriceItem(actor, id, productId);
  return NextResponse.json({ data: null });
});
