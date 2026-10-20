import { NextResponse } from "next/server";
import { z } from "zod";

import { reverseJournal } from "@/modules/accounting/journal-service";
import { reverseJournalSchema } from "@/modules/accounting/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };

const idSchema = z.uuid();

/**
 * Membuat reversal untuk jurnal berstatus `posted`. Dalam satu transaksi:
 *  - Buat draf reversal (sisi baris ditukar; `reversal_of_id` menunjuk jurnal asal).
 *  - Posting draf reversal (nomor & periode baru dihitung seperti posting biasa).
 *  - Status jurnal asal menjadi `reversed`.
 * Alasan wajib dan tersimpan di header reversal.
 * Izin: accounting.journals.reverse
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

  const input = reverseJournalSchema.parse(body);
  const result = await reverseJournal(actor, parsed.data, input);

  return NextResponse.json({ data: result });
});