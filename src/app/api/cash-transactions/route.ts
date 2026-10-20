import { NextResponse } from "next/server";

import {
  createCashTransactionDraft,
  listCashTransactions,
} from "@/modules/accounting/cash-transaction-service";
import {
  createCashTransactionSchema,
  listCashTransactionsQuerySchema,
} from "@/modules/accounting/cash-schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/**
 * Daftar transaksi kas/bank (keyset, terbaru dulu).
 * Filter: ?bankAccountId, ?type=receipt|disbursement|transfer, ?status, ?dateFrom, ?dateTo, ?limit, ?cursor
 * Izin: accounting.cash_transactions.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = listCashTransactionsQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const { items, nextCursor } = await listCashTransactions(actor, query);

  return NextResponse.json(
    { data: items, meta: { nextCursor } },
    { headers: { "Cache-Control": "no-store" } },
  );
});

/**
 * Membuat draf transaksi kas/bank (belum menjurnal). Posting dilakukan terpisah
 * lewat POST /api/cash-transactions/[id]/post yang membuat jurnal double-entry.
 * Izin: accounting.cash_transactions.manage
 */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = createCashTransactionSchema.parse(body);
  const data = await createCashTransactionDraft(actor, input);

  return NextResponse.json({ data }, { status: 201 });
});
