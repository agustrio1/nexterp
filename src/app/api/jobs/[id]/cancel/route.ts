import { NextResponse } from "next/server";

import { cancelJob } from "@/modules/jobs/job-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { idParamsSchema, parseParams } from "@/server/validation";

type Context = { params: Promise<{ id: string }> };

/**
 * Batalkan job yang masih antre. Job berjalan/selesai ditolak (BUSINESS_RULE);
 * pembatalan membebaskan `idempotencyKey` sehingga ekspor bisa diantrekan ulang.
 * Izin: reporting.exports.manage
 */
export const POST = apiHandler(async (_request: Request, context: Context) => {
  const actor = await requireActor();
  const { id } = await parseParams(context.params, idParamsSchema);
  return NextResponse.json({ data: await cancelJob(actor, id) });
});
