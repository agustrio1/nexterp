import { NextResponse } from "next/server";
import { z } from "zod";

import { approveSalesOrder } from "@/modules/sales/so-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/** Setujui sales order yang sudah disetujui penuh (pending_approval -> approved). Izin: sales.orders.post */
export const POST = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) throw notFound("Sales order tidak ditemukan.");
  const data = await approveSalesOrder(actor, id);
  return NextResponse.json({ data });
});
