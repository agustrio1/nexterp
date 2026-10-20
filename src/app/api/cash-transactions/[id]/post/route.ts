import { NextResponse } from "next/server";
import { z } from "zod";

import { postCashTransaction } from "@/modules/accounting/cash-transaction-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/**
 * Memposting transaksi kas/bank: membuat jurnal double-entry (sumber
 * `cash_transaction`) lalu mempostingnya, mengisi nomor dokumen (CT) dan
 * menautkan `journalEntryId`. Hanya draf yang dapat diposting.
 * Izin: accounting.cash_transactions.manage (posting jurnal mengikuti mesin 4D).
 */
export const POST = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Transaksi kas/bank tidak ditemukan.");

  const data = await postCashTransaction(actor, parsed.data);
  return NextResponse.json({ data });
});
