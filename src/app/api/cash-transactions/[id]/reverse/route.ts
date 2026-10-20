import { NextResponse } from "next/server";
import { z } from "zod";

import { reverseCashTransaction } from "@/modules/accounting/cash-transaction-service";
import { reverseCashTransactionSchema } from "@/modules/accounting/cash-schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/**
 * Mereversal transaksi kas/bank terposting: membuat & memposting jurnal pembalik
 * atas jurnal sumber lalu menandai transaksi `reversed`. Transaksi terposting tidak
 * pernah diedit langsung; koreksi lewat reversal (mengikuti mesin jurnal 4D).
 * Izin: accounting.cash_transactions.manage + accounting.journals.reverse
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

  const input = reverseCashTransactionSchema.parse(body);
  const data = await reverseCashTransaction(actor, parsed.data, input);

  return NextResponse.json({ data });
});
