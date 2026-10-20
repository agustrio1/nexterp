import { NextResponse } from "next/server";
import { z } from "zod";

import { createNote, listNotes } from "@/modules/crm/note-service";
import { createNoteSchema } from "@/modules/crm/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

const listQuerySchema = z.object({
  accountId: z.uuid().optional(),
  opportunityId: z.uuid().optional(),
});

/** Daftar catatan, opsional ?accountId=&opportunityId=. Izin: crm.notes.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const filters = listQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await listNotes(actor, filters);
  return NextResponse.json({ data });
});

/** Membuat catatan baru. Izin: crm.notes.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  let body: unknown;
  try { body = await request.json(); } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = createNoteSchema.parse(body);
  const data = await createNote(actor, input);
  return NextResponse.json({ data }, { status: 201 });
});
