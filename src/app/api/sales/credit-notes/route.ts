import { NextResponse } from "next/server";

import { createCreditNote, listCreditNotes } from "@/modules/sales/credit-note-service";
import { createCreditNoteSchema, listSalesQuerySchema } from "@/modules/sales/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/** Daftar nota kredit, opsional ?status=&customerId=&branchId=. Izin: sales.credit_notes.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = listSalesQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const data = await listCreditNotes(actor, query);
  return NextResponse.json({ data });
});

/** Membuat nota kredit baru (draft) dari faktur posted. Izin: sales.credit_notes.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  let body: unknown;
  try { body = await request.json(); } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = createCreditNoteSchema.parse(body);
  const data = await createCreditNote(actor, input);
  return NextResponse.json({ data }, { status: 201 });
});
