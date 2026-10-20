import { NextResponse } from "next/server";
import { z } from "zod";

import { getUnitConversion, updateUnitConversion } from "@/modules/inventory/unit-service";
import { updateUnitConversionSchema } from "@/modules/inventory/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

async function parseId(context: IdContext): Promise<string> {
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Konversi satuan tidak ditemukan.");
  return parsed.data;
}

/** Detail konversi satuan. Izin: inventory.units.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  const data = await getUnitConversion(actor, id);
  return NextResponse.json({ data });
});

/** Mengubah rasio/catatan konversi. Izin: inventory.units.manage */
export const PATCH = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = updateUnitConversionSchema.parse(body);
  const data = await updateUnitConversion(actor, id, input);
  return NextResponse.json({ data });
});
