import { NextResponse } from "next/server";

import {
  importBankStatement,
  listBankStatementLines,
} from "@/modules/accounting/bank-statement-service";
import {
  importBankStatementSchema,
  listBankStatementLinesQuerySchema,
} from "@/modules/accounting/reconciliation-schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/**
 * Daftar baris mutasi bank.
 * Filter: ?bankAccountId=<uuid>, ?reconciliationId=<uuid>, ?matched=true|false,
 *         ?dateFrom=YYYY-MM-DD, ?dateTo=YYYY-MM-DD, ?limit=<int>, ?cursor=<token>
 * Izin: accounting.bank_reconciliations.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = listBankStatementLinesQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await listBankStatementLines(actor, query);

  return NextResponse.json({ data });
});

/** Mengimpor satu atau banyak baris mutasi bank. Izin: accounting.bank_reconciliations.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = importBankStatementSchema.parse(body);
  const data = await importBankStatement(actor, input);

  return NextResponse.json({ data }, { status: 201 });
});
