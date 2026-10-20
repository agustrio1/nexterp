import { NextResponse } from "next/server";
import { z } from "zod";

import { finalizeBankReconciliation } from "@/modules/accounting/reconciliation-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/**
 * Memfinalkan rekonsiliasi: semua baris harus tercocokkan dan saldo akhir statement
 * harus sama dengan saldo buku (GL). Sekali final, dokumen terkunci.
 * Izin: accounting.bank_reconciliations.manage
 */
export const POST = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Rekonsiliasi bank tidak ditemukan.");

  const data = await finalizeBankReconciliation(actor, parsed.data);
  return NextResponse.json({ data });
});
