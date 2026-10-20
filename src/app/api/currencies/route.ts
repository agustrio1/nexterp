import { NextResponse } from "next/server";

import { createCurrency, listCurrencies } from "@/modules/organization/currency-service";
import {
  createCurrencySchema,
  listCurrenciesQuerySchema,
} from "@/modules/organization/finance-schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/**
 * Daftar mata uang, opsional ?isActive=true|false. Setiap baris memuat isBase
 * (true untuk mata uang dasar). Izin: core.currencies.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = listCurrenciesQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await listCurrencies(actor, query);

  return NextResponse.json({ data });
});

/** Membuat mata uang baru. Izin: core.currencies.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = createCurrencySchema.parse(body);
  const currency = await createCurrency(actor, input);

  return NextResponse.json({ data: currency }, { status: 201 });
});