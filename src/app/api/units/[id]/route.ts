import { NextResponse } from "next/server";
import { z } from "zod";

import { getUnit, updateUnit } from "@/modules/inventory/unit-service";
import { updateUnitSchema } from "@/modules/inventory/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

async function parseId(context: IdContext): Promise<string> {
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Satuan tidak ditemukan.");
  return parsed.data;
}

/** Detail satuan. Izin: inventory.units.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  const data = await getUnit(actor, id);
  return NextResponse.json({ data });
});

/** Mengubah satuan (kode tetap). Izin: inventory.units.manage */
export const PATCH = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = updateUnitSchema.parse(body);
  const data = await updateUnit(actor, id, input);
  return NextResponse.json({ data });
});
