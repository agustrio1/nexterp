import { NextResponse } from "next/server";

import { getStatutoryRule, updateStatutoryRule } from "@/modules/payroll/statutory-service";
import { updateStatutoryRuleSchema } from "@/modules/payroll/schemas";
import { readId, readJson } from "@/app/api/payroll/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

type Ctx = { params: Promise<{ id: string }> };

/** Detail aturan + bracket. Izin: payroll.statutory.read */
export const GET = apiHandler(async (_request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Aturan statutory");
  return NextResponse.json({ data: await getStatutoryRule(actor, id) });
});

/** Ubah aturan. Izin: payroll.statutory.manage */
export const PATCH = apiHandler(async (request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Aturan statutory");
  const input = updateStatutoryRuleSchema.parse(await readJson(request));
  return NextResponse.json({ data: await updateStatutoryRule(actor, id, input) });
});
