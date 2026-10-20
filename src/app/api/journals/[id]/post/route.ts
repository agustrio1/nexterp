import { NextResponse } from "next/server";
import { z } from "zod";

import { postJournal } from "@/modules/accounting/journal-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };

const idSchema = z.uuid();

/**
 * Memposting jurnal draf: memeriksa keseimbangan, memilih periode, mengisi total,
 * mengambil nomor dokumen, mengubah status menjadi `posted`.
 * Izin: accounting.journals.post (ditambah accounting.journals.post_closed_period
 * bila periode dalam status soft_closed).
 *
 * Pembuat jurnal diizinkan memposting jurnalnya sendiri; segregrasi tugas ditegakkan
 * lewat assignment role, bukan oleh service.
 */
export const POST = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Jurnal tidak ditemukan.");

  const journal = await postJournal(actor, parsed.data);
  return NextResponse.json({ data: journal });
});