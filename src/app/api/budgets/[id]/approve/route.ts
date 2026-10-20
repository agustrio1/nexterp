import { NextResponse } from "next/server";
import { z } from "zod";

import { approveBudget } from "@/modules/accounting/budget-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/**
 * Menyetujui anggaran: draft -> approved, mengisi nomor dokumen (BGT) dan
 * mengunci header serta barisnya. Hanya draf dengan minimal satu baris.
 * Izin: accounting.budgets.manage
 */
export const POST = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Anggaran tidak ditemukan.");

  const data = await approveBudget(actor, parsed.data);
  return NextResponse.json({ data });
});
