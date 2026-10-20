import { NextResponse } from "next/server";
import { z } from "zod";

import { getFiscalYear } from "@/modules/organization/fiscal-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };

const idSchema = z.uuid();

async function parseFiscalYearId(context: IdContext): Promise<string> {
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);

  // Format id yang salah diperlakukan sebagai tidak ditemukan, bukan 500 dari database.
  if (!parsed.success) {
    throw notFound("Tahun fiskal tidak ditemukan.");
  }
  return parsed.data;
}

/**
 * Detail tahun fiskal beserta seluruh periodenya.
 * Izin: core.fiscal_years.read dan core.periods.read
 */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseFiscalYearId(context);

  const fiscalYear = await getFiscalYear(actor, id);
  return NextResponse.json({ data: fiscalYear });
});