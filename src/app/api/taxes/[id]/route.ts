import { NextResponse } from "next/server";
import { z } from "zod";

import { getTax, updateTax } from "@/modules/accounting/tax-service";
import { updateTaxSchema } from "@/modules/accounting/tax-cost-schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

async function parseId(context: IdContext): Promise<string> {
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Pajak tidak ditemukan.");
  return parsed.data;
}

/** Detail pajak. Izin: accounting.taxes.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  const data = await getTax(actor, id);
  return NextResponse.json({ data });
});

/**
 * Mengubah nama, jenis, akun pajak, isActive, dan/atau description.
 * `code` tidak dapat diubah. Tarif dikelola lewat /api/taxes/[id]/rates.
 * Izin: accounting.taxes.manage
 */
export const PATCH = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = updateTaxSchema.parse(body);
  const data = await updateTax(actor, id, input);
  return NextResponse.json({ data });
});
