import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getProductCategory,
  updateProductCategory,
} from "@/modules/inventory/category-service";
import { updateProductCategorySchema } from "@/modules/inventory/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

async function parseId(context: IdContext): Promise<string> {
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Kategori produk tidak ditemukan.");
  return parsed.data;
}

/** Detail kategori produk. Izin: inventory.product_categories.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  const data = await getProductCategory(actor, id);
  return NextResponse.json({ data });
});

/** Mengubah kategori produk (kode tetap). Izin: inventory.product_categories.manage */
export const PATCH = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = updateProductCategorySchema.parse(body);
  const data = await updateProductCategory(actor, id, input);
  return NextResponse.json({ data });
});
