import { NextResponse } from "next/server";
import { z } from "zod";

import { closeFiscalYear } from "@/modules/accounting/closing-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };

const idSchema = z.uuid();

async function parseId(context: IdContext): Promise<string> {
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Tahun fiskal tidak ditemukan.");
  return parsed.data;
}

/**
 * Menutup tahun fiskal. Memerlukan jurnal penutup terposting, seluruh periode
 * `closed`, dan tahun fiskal sebelumnya sudah ditutup. Izin: accounting.closing.manage
 */
export const POST = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);

  const result = await closeFiscalYear(actor, id);
  return NextResponse.json({ data: result });
});
