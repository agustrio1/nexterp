import { NextResponse } from "next/server";

import { updateAdjustment } from "@/modules/payroll/compensation-service";
import { updateAdjustmentSchema } from "@/modules/payroll/schemas";
import { readId, readJson } from "@/app/api/payroll/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

type Ctx = { params: Promise<{ id: string }> };

/** Ubah penyesuaian (nominal/aktif/catatan). Izin: payroll.adjustments.manage */
export const PATCH = apiHandler(async (request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Penyesuaian");
  const input = updateAdjustmentSchema.parse(await readJson(request));
  return NextResponse.json({ data: await updateAdjustment(actor, id, input) });
});
