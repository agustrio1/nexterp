import { NextResponse } from "next/server";
import { z } from "zod";

import { setStatementLineMatch } from "@/modules/accounting/bank-statement-service";
import { setStatementLineMatchSchema } from "@/modules/accounting/reconciliation-schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/**
 * Mencocokkan (atau membuka cocokan) satu baris statement ke transaksi kas.
 * Body: { cashTransactionId: uuid | null }. Izin: accounting.bank_reconciliations.manage
 */
export const POST = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Baris statement tidak ditemukan.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = setStatementLineMatchSchema.parse(body);
  const data = await setStatementLineMatch(actor, parsed.data, input);

  return NextResponse.json({ data });
});
