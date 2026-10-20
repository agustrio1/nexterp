import { NextResponse } from "next/server";

import {
  createUnitConversion,
  listUnitConversions,
} from "@/modules/inventory/unit-service";
import {
  createUnitConversionSchema,
  listUnitConversionsQuerySchema,
} from "@/modules/inventory/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/**
 * Daftar konversi satuan.
 * Filter: ?fromUnitId=<uuid>, ?toUnitId=<uuid>. Izin: inventory.units.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = listUnitConversionsQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await listUnitConversions(actor, query);
  return NextResponse.json({ data });
});

/** Membuat konversi satuan. Izin: inventory.units.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = createUnitConversionSchema.parse(body);
  const data = await createUnitConversion(actor, input);
  return NextResponse.json({ data }, { status: 201 });
});
