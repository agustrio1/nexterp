import { NextResponse } from "next/server";

import {
  createWarehouseLocation,
  listWarehouseLocations,
} from "@/modules/inventory/warehouse-service";
import {
  createWarehouseLocationSchema,
  listWarehouseLocationsQuerySchema,
} from "@/modules/inventory/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/**
 * Daftar lokasi gudang.
 * Filter: ?warehouseId=<uuid>, ?isActive=true|false. Izin: inventory.warehouses.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = listWarehouseLocationsQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await listWarehouseLocations(actor, query);
  return NextResponse.json({ data });
});

/** Membuat lokasi dalam gudang aktif. Izin: inventory.warehouses.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = createWarehouseLocationSchema.parse(body);
  const data = await createWarehouseLocation(actor, input);
  return NextResponse.json({ data }, { status: 201 });
});
