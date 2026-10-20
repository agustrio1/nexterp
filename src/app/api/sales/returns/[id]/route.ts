import { NextResponse } from "next/server";
import { z } from "zod";

import { getReturn } from "@/modules/sales/return-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/** Detail retur penjualan. Izin: sales.returns.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) throw notFound("Retur tidak ditemukan.");
  const data = await getReturn(actor, id);
  return NextResponse.json({ data });
});
