import { NextResponse } from "next/server";
import { z } from "zod";

import { getPriceList, updatePriceList } from "@/modules/crm/price-list-service";
import { updatePriceListSchema } from "@/modules/crm/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

async function parseId(context: IdContext): Promise<string> {
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Daftar harga tidak ditemukan.");
  return parsed.data;
}

/** Detail price list + items. Izin: crm.price_lists.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  const data = await getPriceList(actor, id);
  return NextResponse.json({ data });
});

/** Ubah price list. Izin: crm.price_lists.manage */
export const PATCH = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  let body: unknown;
  try { body = await request.json(); } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = updatePriceListSchema.parse(body);
  const data = await updatePriceList(actor, id, input);
  return NextResponse.json({ data });
});
