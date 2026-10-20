import { NextResponse } from "next/server";

import { createExchangeRate, listExchangeRates } from "@/modules/organization/currency-service";
import {
  createExchangeRateSchema,
  listExchangeRatesQuerySchema,
} from "@/modules/organization/finance-schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/**
 * Daftar kurs berpaginasi keyset, terbaru dulu. Filter query: `fromCurrency`, `dateFrom`,
 * `dateTo` (YYYY-MM-DD), `limit` (1..100, default 20), `cursor` (opaque). Izin: core.exchange_rates.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = listExchangeRatesQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const { items, nextCursor, hasMore } = await listExchangeRates(actor, query);

  return NextResponse.json({
    data: items,
    meta: { limit: query.limit, cursor: query.cursor ?? null, nextCursor, hasMore },
  });
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