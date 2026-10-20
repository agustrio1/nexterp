import { NextResponse } from "next/server";

import { inventoryValuationQuerySchema } from "@/modules/inventory/report-schemas";
import { inventoryValuation } from "@/modules/inventory/report-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/**
 * Valuasi persediaan: Σ `quantityRemaining × unitCost` lapisan FIFO per
 * produk+gudang (posisi kini). Opsional: productId, warehouseId, branchId.
 * Izin: inventory.stock.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = inventoryValuationQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await inventoryValuation(actor, query);

  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});
