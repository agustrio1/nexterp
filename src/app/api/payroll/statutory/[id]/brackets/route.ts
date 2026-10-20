import { NextResponse } from "next/server";

import { addBracket } from "@/modules/payroll/statutory-service";
import { createBracketSchema } from "@/modules/payroll/schemas";
import { readId, readJson } from "@/app/api/payroll/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

type Ctx = { params: Promise<{ id: string }> };

/** Tambah bracket progresif pada aturan (source WAJIB). Izin: payroll.statutory.manage */
export const POST = apiHandler(async (request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const ruleId = await readId(ctx, "Aturan statutory");
  const input = createBracketSchema.parse(await readJson(request));
  return NextResponse.json({ data: await addBracket(actor, ruleId, input) }, { status: 201 });
});
