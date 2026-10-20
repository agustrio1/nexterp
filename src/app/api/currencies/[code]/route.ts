import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrency, updateCurrency } from "@/modules/organization/currency-service";
import { updateCurrencySchema } from "@/modules/organization/finance-schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type CodeContext = { params: Promise<{ code: string }> };

const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/);

async function parseCurrencyCode(context: CodeContext): Promise<string> {
  const { code } = await context.params;
  const parsed = codeSchema.safeParse(code);

  // Format kode yang salah diperlakukan sebagai tidak ditemukan.
  if (!parsed.success) {
    throw notFound("Mata uang tidak ditemukan.");
  }
  return parsed.data;
}

/** Detail mata uang (memuat isBase). Izin: core.currencies.read */
export const GET = apiHandler(async (_request: Request, context: CodeContext) => {
  const actor = await requireActor();
  const code = await parseCurrencyCode(context);

  const currency = await getCurrency(actor, code);
  return NextResponse.json({ data: currency });
});

/**
 * Mengubah nama, simbol, jumlah desimal, dan/atau status aktif. Izin: core.currencies.manage
 * Kode tidak bisa diubah. Tidak ada DELETE: mata uang hanya dinonaktifkan.
 */
export const PATCH = apiHandler(async (request: Request, context: CodeContext) => {
  const actor = await requireActor();
  const code = await parseCurrencyCode(context);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = updateCurrencySchema.parse(body);
  const currency = await updateCurrency(actor, code, input);

  return NextResponse.json({ data: currency });
});