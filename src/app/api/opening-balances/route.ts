import { NextResponse } from "next/server";

import { createOpeningBalanceSchema } from "@/modules/accounting/closing-schemas";
import { createOpeningBalanceDraft } from "@/modules/accounting/closing-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/**
 * Membuat draf jurnal SALDO AWAL (source `opening_balance`) untuk suatu tahun fiskal.
 * Tanggal dipaksa = awal tahun; periode = P1. Posting lewat POST /api/journals/[id]/post.
 * Izin: accounting.opening.manage
 */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = createOpeningBalanceSchema.parse(body);
  const draft = await createOpeningBalanceDraft(actor, input);

  return NextResponse.json({ data: draft }, { status: 201 });
});
