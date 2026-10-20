import { NextResponse } from "next/server";
import { z } from "zod";

import { cancelDraftJournal } from "@/modules/accounting/journal-service";
import { cancelJournalSchema } from "@/modules/accounting/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };

const idSchema = z.uuid();

/**
 * Membatalkan draf jurnal. Alasan wajib. Setelah dibatalkan, jurnal tidak dapat
 * diubah maupun diposting; status akhir `cancelled`.
 * Izin: accounting.journals.cancel
 */
export const POST = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Jurnal tidak ditemukan.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = cancelJournalSchema.parse(body);
  const journal = await cancelDraftJournal(actor, parsed.data, input);

  return NextResponse.json({ data: journal });
});