import { NextResponse } from "next/server";

import {
  createFiscalYearSchema,
  listFiscalYearsQuerySchema,
} from "@/modules/organization/finance-schemas";
import { createFiscalYear, listFiscalYears } from "@/modules/organization/fiscal-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/** Daftar tahun fiskal, terbaru dulu. Filter opsional: ?status=open|closed. Izin: core.fiscal_years.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = listFiscalYearsQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await listFiscalYears(actor, query);

  return NextResponse.json({ data });
});

/**
 * Membuat tahun fiskal beserta periode bulanannya (dan periode ke-13 bila diminta).
 * Izin: core.fiscal_years.manage
 */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = createFiscalYearSchema.parse(body);
  const fiscalYear = await createFiscalYear(actor, input);

  return NextResponse.json({ data: fiscalYear }, { status: 201 });
});