import { NextResponse } from "next/server";

import { reorderQuerySchema } from "@/modules/inventory/report-schemas";
import { reorderReport } from "@/modules/inventory/report-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/**
 * Reorder: produk dengan `reorderPoint` terisi dan stok tersedia di bawah
 * titik pemesanan kembali. Opsional: productId, warehouseId, branchId.
 * Izin: inventory.stock.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = reorderQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await reorderReport(actor, query);

  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});
