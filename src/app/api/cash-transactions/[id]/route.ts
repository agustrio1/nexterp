import { NextResponse } from "next/server";
import { z } from "zod";

import { getCashTransaction } from "@/modules/accounting/cash-transaction-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/** Detail transaksi kas/bank. Izin: accounting.cash_transactions.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Transaksi kas/bank tidak ditemukan.");

  const data = await getCashTransaction(actor, parsed.data);
  return NextResponse.json({ data });
});
