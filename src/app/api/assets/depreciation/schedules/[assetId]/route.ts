import { NextResponse } from "next/server";
import { z } from "zod";

import { listSchedules } from "@/modules/assets/depreciation-run-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { parseParams } from "@/server/validation";

type Context = { params: Promise<{ assetId: string }> };

const assetIdParamsSchema = z.object({ assetId: z.uuid("ID tidak valid.") });

/** Jadwal penyusutan sebuah aset (ledger per periode). Izin: assets.depreciation.read */
export const GET = apiHandler(async (_request: Request, context: Context) => {
  const actor = await requireActor();
  const { assetId } = await parseParams(context.params, assetIdParamsSchema);
  return NextResponse.json({ data: await listSchedules(actor, assetId) });
});
