import { NextResponse } from "next/server";

import { listUsage, upsertUsage } from "@/modules/assets/asset-service";
import { upsertUsageSchema } from "@/modules/assets/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { idParamsSchema, parseBody, parseParams } from "@/server/validation";

type Context = { params: Promise<{ id: string }> };

/** Daftar pemakaian (usage) sebuah aset. Izin: assets.register.read */
export const GET = apiHandler(async (_request: Request, context: Context) => {
  const actor = await requireActor();
  const { id } = await parseParams(context.params, idParamsSchema);
  return NextResponse.json({ data: await listUsage(actor, id) });
});

/** Catat/ubah pemakaian satuan untuk satu periode (units_of_production). Izin: assets.register.manage */
export const POST = apiHandler(async (request: Request, context: Context) => {
  const actor = await requireActor();
  const { id } = await parseParams(context.params, idParamsSchema);
  const input = await parseBody(request, upsertUsageSchema);
  return NextResponse.json({ data: await upsertUsage(actor, id, input) }, { status: 201 });
});
