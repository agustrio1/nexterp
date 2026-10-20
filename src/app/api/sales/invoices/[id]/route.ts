import { NextResponse } from "next/server";
import { z } from "zod";

import { getInvoice } from "@/modules/sales/invoice-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/** Detail faktur penjualan. Izin: sales.invoices.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) throw notFound("Faktur tidak ditemukan.");
  const data = await getInvoice(actor, id);
  return NextResponse.json({ data });
});
