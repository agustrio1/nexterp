import { NextResponse } from "next/server";

import {
  createTaxTransaction,
  listTaxTransactions,
} from "@/modules/accounting/tax-transaction-service";
import {
  createTaxTransactionSchema,
  listTaxTransactionsQuerySchema,
} from "@/modules/accounting/tax-cost-schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/**
 * Daftar transaksi pajak (keyset, terbaru dulu).
 * Filter: ?taxId, ?direction=collect|pay, ?dateFrom, ?dateTo, ?limit, ?cursor
 * Izin: accounting.tax_transactions.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = listTaxTransactionsQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const { items, nextCursor } = await listTaxTransactions(actor, query);

  return NextResponse.json(
    { data: items, meta: { nextCursor } },
    { headers: { "Cache-Control": "no-store" } },
  );
});

/**
 * Mencatat transaksi pajak (subledger). Tarif disnapshot dari tarif berlaku pada
 * tanggal transaksi; taxAmount dihitung otomatis (base × rate%, HALF_UP 2dp).
 * Tidak membuat jurnal (integrasi jurnal terjadi pada AP/AR Tahap 5/6).
 * Izin: accounting.tax_transactions.manage
 */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = createTaxTransactionSchema.parse(body);
  const data = await createTaxTransaction(actor, input);

  return NextResponse.json({ data }, { status: 201 });
});
