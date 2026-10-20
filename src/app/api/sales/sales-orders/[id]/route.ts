import { NextResponse } from "next/server";
import { z } from "zod";

import { getSalesOrder, updateSalesOrder } from "@/modules/sales/so-service";
import { updateSalesOrderSchema } from "@/modules/sales/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

async function parseId(context: IdContext): Promise<string> {
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Sales order tidak ditemukan.");
  return parsed.data;
}

/** Detail sales order. Izin: sales.orders.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  const data = await getSalesOrder(actor, id);
  return NextResponse.json({ data });
});

/** Ubah sales order (draft). Izin: sales.orders.manage */
export const PATCH = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  let body: unknown;
  try { body = await request.json(); } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = updateSalesOrderSchema.parse(body);
  const data = await updateSalesOrder(actor, id, input);
  return NextResponse.json({ data });
});
