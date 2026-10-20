import { z } from "zod";
import { NextResponse } from "next/server";

import { createStatutoryRule, listStatutoryRules } from "@/modules/payroll/statutory-service";
import { createStatutoryRuleSchema } from "@/modules/payroll/schemas";
import { readJson } from "@/app/api/payroll/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/** Daftar aturan statutory. ?isActive=, ?kind=. Izin: payroll.statutory.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const sp = new URL(request.url).searchParams;
  const isActiveRaw = sp.get("isActive");
  const kindRaw = sp.get("kind");
  const isActive = isActiveRaw ? z.enum(["true", "false"]).parse(isActiveRaw) === "true" : undefined;
  const kind = kindRaw ?? undefined;
  return NextResponse.json({ data: await listStatutoryRules(actor, { isActive, kind }) });
});

/** Buat aturan statutory (source regulasi WAJIB). Izin: payroll.statutory.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const input = createStatutoryRuleSchema.parse(await readJson(request));
  return NextResponse.json({ data: await createStatutoryRule(actor, input) }, { status: 201 });
});
