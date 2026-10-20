import { NextResponse } from "next/server";
import { z } from "zod";

import { createTaxRate, listTaxRates } from "@/modules/accounting/tax-service";
import { createTaxRateSchema } from "@/modules/accounting/tax-cost-schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

async function parseId(context: IdContext): Promise<string> {
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Pajak tidak ditemukan.");
  return parsed.data;
}

/** Daftar tarif pajak (terbaru dulu). Izin: accounting.taxes.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  const data = await listTaxRates(actor, id);
  return NextResponse.json({ data });
});

/**
 * Menambahkan tarif bertanggal efektif. Sumber resmi WAJIB diisi — sistem tidak
 * mengarang tarif. Tarif berlaku = effectiveFrom terbaru <= tanggal transaksi.
 * Izin: accounting.taxes.manage
 */
export const POST = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = createTaxRateSchema.parse(body);
  const data = await createTaxRate(actor, id, input);

  return NextResponse.json({ data }, { status: 201 });
});
