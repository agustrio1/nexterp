import { NextResponse } from "next/server";
import { z } from "zod";

import { getReconciliation } from "@/modules/accounting/reconciliation-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/** Detail rekonsiliasi beserta baris & ringkasan. Izin: accounting.bank_reconciliations.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Rekonsiliasi bank tidak ditemukan.");

  const data = await getReconciliation(actor, parsed.data);
  return NextResponse.json({ data });
});
