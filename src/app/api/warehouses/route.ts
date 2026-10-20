import { NextResponse } from "next/server";

import { createWarehouse, listWarehouses } from "@/modules/inventory/warehouse-service";
import { createWarehouseSchema, listWarehousesQuerySchema } from "@/modules/inventory/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/**
 * Daftar gudang.
 * Filter: ?isActive=true|false, ?branchId=<uuid>. Izin: inventory.warehouses.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = listWarehousesQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await listWarehouses(actor, query);
  return NextResponse.json({ data });
});

/** Membuat gudang (terikat satu cabang aktif). Izin: inventory.warehouses.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = createWarehouseSchema.parse(body);
  const data = await createWarehouse(actor, input);
  return NextResponse.json({ data }, { status: 201 });
});
