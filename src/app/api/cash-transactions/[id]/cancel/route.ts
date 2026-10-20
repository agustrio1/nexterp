import { NextResponse } from "next/server";
import { z } from "zod";

import { cancelCashTransaction } from "@/modules/accounting/cash-transaction-service";
import { cancelCashTransactionSchema } from "@/modules/accounting/cash-schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/**
 * Membatalkan draf transaksi kas/bank (alasan wajib). Hanya draf yang dapat
 * dibatalkan; transaksi terposting dibetulkan lewat reversal.
 * Izin: accounting.cash_transactions.manage
 */
export const POST = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Transaksi kas/bank tidak ditemukan.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = cancelCashTransactionSchema.parse(body);
  const data = await cancelCashTransaction(actor, parsed.data, input);

  return NextResponse.json({ data });
});
