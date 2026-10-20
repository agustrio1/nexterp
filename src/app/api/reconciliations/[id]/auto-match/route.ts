import { NextResponse } from "next/server";
import { z } from "zod";

import { autoMatchReconciliation } from "@/modules/accounting/reconciliation-service";
import { autoMatchReconciliationSchema } from "@/modules/accounting/reconciliation-schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/**
 * Mencocokkan otomatis baris statement ke transaksi kas (amount + arah + tanggal).
 * Body opsional: { toleranceDays?: int 0..30 }. Izin: accounting.bank_reconciliations.manage
 */
export const POST = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Rekonsiliasi bank tidak ditemukan.");

  let body: unknown = {};
  try {
    const text = await request.text();
    body = text === "" ? {} : JSON.parse(text);
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = autoMatchReconciliationSchema.parse(body);
  const data = await autoMatchReconciliation(actor, parsed.data, input.toleranceDays ?? 3);

  return NextResponse.json({ data });
});
