import { NextResponse } from "next/server";
import { z } from "zod";

import { getTaxTransaction } from "@/modules/accounting/tax-transaction-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/** Detail transaksi pajak. Izin: accounting.tax_transactions.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Transaksi pajak tidak ditemukan.");

  const data = await getTaxTransaction(actor, parsed.data);
  return NextResponse.json({ data });
});
