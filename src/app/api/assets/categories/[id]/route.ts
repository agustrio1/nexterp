import { NextResponse } from "next/server";

import { getCategory, updateCategory } from "@/modules/assets/category-service";
import { updateCategorySchema } from "@/modules/assets/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { idParamsSchema, parseBody, parseParams } from "@/server/validation";

type Context = { params: Promise<{ id: string }> };

/** Detail kategori aset. Izin: assets.categories.read */
export const GET = apiHandler(async (_request: Request, context: Context) => {
  const actor = await requireActor();
  const { id } = await parseParams(context.params, idParamsSchema);
  return NextResponse.json({ data: await getCategory(actor, id) });
});

/** Ubah kategori / nonaktifkan. Izin: assets.categories.manage */
export const PATCH = apiHandler(async (request: Request, context: Context) => {
  const actor = await requireActor();
  const { id } = await parseParams(context.params, idParamsSchema);
  const input = await parseBody(request, updateCategorySchema);
  return NextResponse.json({ data: await updateCategory(actor, id, input) });
});
