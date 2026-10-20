import { NextResponse } from "next/server";
import { z } from "zod";

import { getProduct, updateProduct } from "@/modules/inventory/product-service";
import { updateProductSchema } from "@/modules/inventory/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

async function parseId(context: IdContext): Promise<string> {
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Produk tidak ditemukan.");
  return parsed.data;
}

/** Detail produk. Izin: inventory.products.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  const data = await getProduct(actor, id);
  return NextResponse.json({ data });
});

/** Mengubah produk (SKU tetap). Izin: inventory.products.manage */
export const PATCH = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = updateProductSchema.parse(body);
  const data = await updateProduct(actor, id, input);
  return NextResponse.json({ data });
});
