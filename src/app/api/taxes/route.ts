import { NextResponse } from "next/server";

import { createTax, listTaxes } from "@/modules/accounting/tax-service";
import { createTaxSchema, listTaxesQuerySchema } from "@/modules/accounting/tax-cost-schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/**
 * Daftar pajak. Filter: ?isActive=true|false, ?kind=output|input|withholding
 * Izin: accounting.taxes.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = listTaxesQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await listTaxes(actor, query);

  return NextResponse.json({ data });
});

/** Membuat master pajak. Izin: accounting.taxes.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = createTaxSchema.parse(body);
  const data = await createTax(actor, input);

  return NextResponse.json({ data }, { status: 201 });
});
