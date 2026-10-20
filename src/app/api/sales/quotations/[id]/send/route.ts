import { NextResponse } from "next/server";
import { z } from "zod";

import { sendQuotation } from "@/modules/sales/quotation-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/** Tandai quotation terkirim (draft -> sent). Izin: sales.quotations.manage */
export const POST = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) throw notFound("Penawaran tidak ditemukan.");
  const data = await sendQuotation(actor, id);
  return NextResponse.json({ data });
});
