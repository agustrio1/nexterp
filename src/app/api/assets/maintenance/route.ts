import { NextResponse } from "next/server";
import { z } from "zod";

import { createMaintenance, listMaintenance } from "@/modules/assets/ops-service";
import { createMaintenanceSchema } from "@/modules/assets/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { parseBody, parseQuery } from "@/server/validation";

const listQuery = z.object({ assetId: z.uuid().optional() });

/** Daftar catatan perawatan aset. ?assetId=. Izin: assets.register.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const { assetId } = parseQuery(request, listQuery);
  return NextResponse.json({ data: await listMaintenance(actor, assetId) });
});

/** Catat perawatan/perbaikan aset. Izin: assets.register.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const input = await parseBody(request, createMaintenanceSchema);
  return NextResponse.json({ data: await createMaintenance(actor, input) }, { status: 201 });
});
