import { NextResponse } from "next/server";
import { z } from "zod";

import { reverseStockDocument } from "@/modules/inventory/document-service";
import { reverseStockDocumentSchema } from "@/modules/inventory/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/**
 * Mereversal dokumen stok terposting: membuat pergerakan penyeimbang (reverseOfId
 * menunjuk pergerakan asal) untuk setiap pergerakan dokumen lalu menandai header
 * `reversed`. Dokumen posted tidak pernah diedit langsung; koreksi lewat reversal.
 * Izin: inventory.documents.manage + inventory.stock.manage
 */
export const POST = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Dokumen stok tidak ditemukan.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = reverseStockDocumentSchema.parse(body);
  const data = await reverseStockDocument(actor, parsed.data, input);

  return NextResponse.json({ data });
});
