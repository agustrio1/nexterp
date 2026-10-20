import { NextResponse } from "next/server";
import { z } from "zod";

import { createRevaluation, listRevaluations } from "@/modules/assets/revaluation-service";
import { createRevaluationSchema } from "@/modules/assets/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { parseBody, parseQuery } from "@/server/validation";

const listQuery = z.object({ assetId: z.uuid().optional() });

/** Daftar revaluasi. ?assetId=. Izin: assets.register.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const { assetId } = parseQuery(request, listQuery);
  return NextResponse.json({ data: await listRevaluations(actor, assetId) });
});

/** Buat revaluasi (draf). Izin: assets.revaluation.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const input = await parseBody(request, createRevaluationSchema);
  return NextResponse.json({ data: await createRevaluation(actor, input) }, { status: 201 });
});
