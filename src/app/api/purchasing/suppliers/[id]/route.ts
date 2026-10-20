import { NextResponse } from "next/server";
import { z } from "zod";

import { getSupplier, updateSupplier } from "@/modules/purchasing/supplier-service";
import { updateSupplierSchema } from "@/modules/purchasing/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

async function parseId(context: IdContext): Promise<string> {
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Pemasok tidak ditemukan.");
  return parsed.data;
}

/** Detail pemasok. Izin: purchasing.suppliers.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  const data = await getSupplier(actor, id);
  return NextResponse.json({ data });
});

/** Mengubah pemasok (kode tidak dapat diubah). Izin: purchasing.suppliers.manage */
export const PATCH = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = updateSupplierSchema.parse(body);
  const data = await updateSupplier(actor, id, input);
  return NextResponse.json({ data });
});
