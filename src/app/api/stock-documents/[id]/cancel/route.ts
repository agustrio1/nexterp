import { NextResponse } from "next/server";
import { z } from "zod";

import { cancelStockDocument } from "@/modules/inventory/document-service";
import { cancelStockDocumentSchema } from "@/modules/inventory/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/**
 * Membatalkan draf dokumen stok (alasan wajib). Hanya draf yang dapat dibatalkan;
 * dokumen terposting dikoreksi lewat reversal. Izin: inventory.documents.manage
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

  const input = cancelStockDocumentSchema.parse(body);
  const data = await cancelStockDocument(actor, parsed.data, input);

  return NextResponse.json({ data });
});
