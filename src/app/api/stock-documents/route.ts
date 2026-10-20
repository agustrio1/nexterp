import { NextResponse } from "next/server";

import {
  createStockDocument,
  listStockDocuments,
} from "@/modules/inventory/document-service";
import {
  createStockDocumentSchema,
  listStockDocumentsQuerySchema,
} from "@/modules/inventory/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/**
 * Daftar dokumen stok (terbaru dulu).
 * Filter: ?type, ?status, ?branchId, ?fromWarehouseId, ?toWarehouseId
 * Izin: inventory.documents.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = listStockDocumentsQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await listStockDocuments(actor, query);

  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});

/**
 * Membuat draf dokumen stok (receipt/issue/transfer/adjustment/opname). Belum
 * ada pergerakan ledger; posting dilakukan terpisah via /api/stock-documents/[id]/post.
 * Izin: inventory.documents.manage
 */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = createStockDocumentSchema.parse(body);
  const data = await createStockDocument(actor, input);

  return NextResponse.json({ data }, { status: 201 });
});
