import { NextResponse } from "next/server";

import { createCategory, listCategories } from "@/modules/assets/category-service";
import { createCategorySchema, listCategoriesQuery } from "@/modules/assets/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/** Daftar kategori aset. ?isActive=true|false. Izin: assets.categories.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = listCategoriesQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
  const data = await listCategories(actor, query);
  return NextResponse.json({ data });
});

/** Buat kategori aset. Izin: assets.categories.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = createCategorySchema.parse(body);
  const data = await createCategory(actor, input);
  return NextResponse.json({ data }, { status: 201 });
});
