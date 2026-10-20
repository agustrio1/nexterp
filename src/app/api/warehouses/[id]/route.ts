import { NextResponse } from "next/server";
import { z } from "zod";

import { getWarehouse, updateWarehouse } from "@/modules/inventory/warehouse-service";
import { updateWarehouseSchema } from "@/modules/inventory/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

async function parseId(context: IdContext): Promise<string> {
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Gudang tidak ditemukan.");
  return parsed.data;
}

/** Detail gudang. Izin: inventory.warehouses.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  const data = await getWarehouse(actor, id);
  return NextResponse.json({ data });
});

/** Mengubah gudang (kode tetap). Izin: inventory.warehouses.manage */
export const PATCH = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = updateWarehouseSchema.parse(body);
  const data = await updateWarehouse(actor, id, input);
  return NextResponse.json({ data });
});
