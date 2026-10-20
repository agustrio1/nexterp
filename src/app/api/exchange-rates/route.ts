import { NextResponse } from "next/server";

import { createExchangeRate, listExchangeRates } from "@/modules/organization/currency-service";
import {
  createExchangeRateSchema,
  listExchangeRatesQuerySchema,
} from "@/modules/organization/finance-schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/**
 * Daftar kurs berpaginasi, terbaru dulu. Filter: ?fromCurrency, ?dateFrom, ?dateTo (YYYY-MM-DD),
 * ?page, ?pageSize. Izin: core.exchange_rates.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = listExchangeRatesQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const { items, total, page, pageSize } = await listExchangeRates(actor, query);

  return NextResponse.json({ data: items, meta: { total, page, pageSize } });
});

/**
 * Membuat kurs: 1 satuan fromCurrency = rate satuan mata uang dasar. Kurs tidak bisa diubah
 * setelah dibuat. Izin: core.exchange_rates.manage
 */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = createExchangeRateSchema.parse(body);
  const rate = await createExchangeRate(actor, input);

  return NextResponse.json({ data: rate }, { status: 201 });
});