import { NextResponse } from "next/server";

import { createUnit, listUnits } from "@/modules/inventory/unit-service";
import { createUnitSchema, listUnitsQuerySchema } from "@/modules/inventory/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/**
 * Daftar satuan (unit of measure).
 * Filter: ?isActive=true|false. Izin: inventory.units.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = listUnitsQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const data = await listUnits(actor, query);
  return NextResponse.json({ data });
});

/** Membuat satuan baru. Izin: inventory.units.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = createUnitSchema.parse(body);
  const data = await createUnit(actor, input);
  return NextResponse.json({ data }, { status: 201 });
});
