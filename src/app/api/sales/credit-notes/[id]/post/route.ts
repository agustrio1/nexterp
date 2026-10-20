import { NextResponse } from "next/server";
import { z } from "zod";

import { postCreditNote } from "@/modules/sales/credit-note-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/** Posting nota kredit: jurnal Dr Revenue / Cr AR, kurangi saldo faktur. Izin: sales.credit_notes.post */
export const POST = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) throw notFound("Nota kredit tidak ditemukan.");
  const data = await postCreditNote(actor, id);
  return NextResponse.json({ data });
});
