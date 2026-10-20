import { NextResponse } from "next/server";

import { createProduct, listProducts } from "@/modules/inventory/product-service";
import { createProductSchema, listProductsQuerySchema } from "@/modules/inventory/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/**
 * Daftar produk.
 * Filter: ?isActive=true|false, ?categoryId=<uuid>, ?baseUnitId=<uuid>, ?search=<tek>
 * Izin: inventory.products.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = listProductsQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const data = await listProducts(actor, query);
  return NextResponse.json({ data });
});

/** Membuat produk baru. Izin: inventory.products.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = createProductSchema.parse(body);
  const data = await createProduct(actor, input);
  return NextResponse.json({ data }, { status: 201 });
});
