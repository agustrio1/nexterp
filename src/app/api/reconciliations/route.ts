import { NextResponse } from "next/server";

import {
  createBankReconciliation,
  listBankReconciliations,
} from "@/modules/accounting/reconciliation-service";
import {
  createBankReconciliationSchema,
  listBankReconciliationsQuerySchema,
} from "@/modules/accounting/reconciliation-schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/**
 * Daftar rekonsiliasi bank.
 * Filter: ?bankAccountId=<uuid>, ?status=draft|final,
 *         ?dateFrom=YYYY-MM-DD, ?dateTo=YYYY-MM-DD, ?limit=<int>, ?cursor=<token>
 * Izin: accounting.bank_reconciliations.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = listBankReconciliationsQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await listBankReconciliations(actor, query);

  return NextResponse.json({ data });
});

/**
 * Membuat rekonsiliasi draft untuk satu rekening & rentang; menarik baris statement
 * yang belum tertugaskan dalam rentang tersebut. Opsional auto-match (autoMatch, toleranceDays).
 * Izin: accounting.bank_reconciliations.manage
 */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = createBankReconciliationSchema.parse(body);
  const data = await createBankReconciliation(actor, input);

  return NextResponse.json({ data }, { status: 201 });
});
