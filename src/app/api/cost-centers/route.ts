import { NextResponse } from "next/server";

import {
  createCostCenter,
  listCostCenters,
} from "@/modules/accounting/cost-center-service";
import {
  createCostCenterSchema,
  listCostCentersQuerySchema,
} from "@/modules/accounting/tax-cost-schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/**
 * Daftar pusat biaya (datar; pohon disusun lewat parentId oleh pemanggil).
 * Filter: ?isActive=true|false, ?branchId=<uuid>
 * Izin: accounting.cost_centers.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = listCostCentersQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await listCostCenters(actor, query);

  return NextResponse.json({ data });
});

/** Membuat pusat biaya. Izin: accounting.cost_centers.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = createCostCenterSchema.parse(body);
  const costCenter = await createCostCenter(actor, input);

  return NextResponse.json({ data: costCenter }, { status: 201 });
});
