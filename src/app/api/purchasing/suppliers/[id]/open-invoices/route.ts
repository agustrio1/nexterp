import { NextResponse } from "next/server";
import { z } from "zod";

import { listOpenInvoices } from "@/modules/purchasing/invoice-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/**
 * Posisi utang terbuka (invoice posted belum lunas) per pemasok, urut jatuh tempo.
 * Izin: purchasing.ap.read
 */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Pemasok tidak ditemukan.");

  const data = await listOpenInvoices(actor, parsed.data);
  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});
