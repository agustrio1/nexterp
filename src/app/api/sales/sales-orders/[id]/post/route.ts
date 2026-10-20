import { NextResponse } from "next/server";
import { z } from "zod";

import { postSalesOrder } from "@/modules/sales/so-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/** Posting sales order (approved -> posted): kunci kurs, cek limit kredit, terbitkan nomor. Izin: sales.orders.post */
export const POST = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) throw notFound("Sales order tidak ditemukan.");
  const data = await postSalesOrder(actor, id);
  return NextResponse.json({ data });
});
