import { NextResponse } from "next/server";
import { z } from "zod";

import { changePeriodStatusSchema } from "@/modules/organization/finance-schemas";
import { changePeriodStatus } from "@/modules/organization/fiscal-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };

const idSchema = z.uuid();

async function parsePeriodId(context: IdContext): Promise<string> {
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);

  // Format id yang salah diperlakukan sebagai tidak ditemukan, bukan 500 dari database.
  if (!parsed.success) {
    throw notFound("Periode tidak ditemukan.");
  }
  return parsed.data;
}

/**
 * Mengubah status periode akuntansi: open, soft_closed, atau closed.
 * Menutup membutuhkan core.periods.close; membuka kembali membutuhkan core.periods.reopen
 * dan alasan (reason). Aturan urutan antarperiode ditegakkan di service.
 */
export const POST = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parsePeriodId(context);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = changePeriodStatusSchema.parse(body);
  const period = await changePeriodStatus(actor, id, input);

  return NextResponse.json({ data: period });
});