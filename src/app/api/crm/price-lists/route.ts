import { NextResponse } from "next/server";

import { createPriceList, listPriceLists } from "@/modules/crm/price-list-service";
import { createPriceListSchema, listQuerySchema } from "@/modules/crm/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/** Daftar price list, opsional ?isActive=. Izin: crm.price_lists.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = listQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await listPriceLists(actor, query);
  return NextResponse.json({ data });
});

/** Membuat price list baru. Izin: crm.price_lists.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  let body: unknown;
  try { body = await request.json(); } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = createPriceListSchema.parse(body);
  const data = await createPriceList(actor, input);
  return NextResponse.json({ data }, { status: 201 });
});
