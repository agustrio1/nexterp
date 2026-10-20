import { NextResponse } from "next/server";

import { stockCardQuerySchema } from "@/modules/inventory/report-schemas";
import { stockCard } from "@/modules/inventory/report-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/**
 * Kartu stok: pergerakan + saldo berjalan kuantitas & nilai per produk
 * (opsional per gudang) dalam rentang tanggal.
 * Query (wajib): productId. Opsional: warehouseId, from, to.
 * Izin: inventory.stock.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = stockCardQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await stockCard(actor, query);

  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});
