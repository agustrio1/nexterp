import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getWarehouseLocation,
  updateWarehouseLocation,
} from "@/modules/inventory/warehouse-service";
import { updateWarehouseLocationSchema } from "@/modules/inventory/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

async function parseId(context: IdContext): Promise<string> {
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Lokasi gudang tidak ditemukan.");
  return parsed.data;
}

/** Detail lokasi gudang. Izin: inventory.warehouses.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  const data = await getWarehouseLocation(actor, id);
  return NextResponse.json({ data });
});

/** Mengubah lokasi (gudang & kode tetap). Izin: inventory.warehouses.manage */
export const PATCH = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = updateWarehouseLocationSchema.parse(body);
  const data = await updateWarehouseLocation(actor, id, input);
  return NextResponse.json({ data });
});
