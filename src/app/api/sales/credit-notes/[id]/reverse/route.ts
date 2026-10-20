import { NextResponse } from "next/server";
import { z } from "zod";

import { reverseCreditNote } from "@/modules/sales/credit-note-service";
import { cancelDocSchema } from "@/modules/sales/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/** Reverse nota kredit posted: reverse jurnal, pulihkan saldo faktur. Izin: sales.credit_notes.post */
export const POST = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) throw notFound("Nota kredit tidak ditemukan.");
  let body: unknown;
  try { body = await request.json(); } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = cancelDocSchema.parse(body);
  const data = await reverseCreditNote(actor, id, input.reason);
  return NextResponse.json({ data });
});
