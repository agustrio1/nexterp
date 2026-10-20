import { NextResponse } from "next/server";

import {
  createProductCategory,
  listProductCategories,
} from "@/modules/inventory/category-service";
import {
  createProductCategorySchema,
  listProductCategoriesQuerySchema,
} from "@/modules/inventory/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/**
 * Daftar kategori produk (datar).
 * Filter: ?isActive=true|false, ?parentId=<uuid>. Izin: inventory.product_categories.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = listProductCategoriesQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await listProductCategories(actor, query);
  return NextResponse.json({ data });
});

/** Membuat kategori produk. Izin: inventory.product_categories.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = createProductCategorySchema.parse(body);
  const data = await createProductCategory(actor, input);
  return NextResponse.json({ data }, { status: 201 });
});
