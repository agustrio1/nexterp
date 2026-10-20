import { NextResponse } from "next/server";
import { z } from "zod";

import { getCreditNote } from "@/modules/sales/credit-note-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/** Detail nota kredit. Izin: sales.credit_notes.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) throw notFound("Nota kredit tidak ditemukan.");
  const data = await getCreditNote(actor, id);
  return NextResponse.json({ data });
});
