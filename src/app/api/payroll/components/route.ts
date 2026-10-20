import { z } from "zod";
import { NextResponse } from "next/server";

import { createComponent, listComponents } from "@/modules/payroll/component-service";
import { createComponentSchema } from "@/modules/payroll/schemas";
import { readJson } from "@/app/api/payroll/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/** Daftar komponen gaji. ?isActive=, ?kind=earning|deduction. Izin: payroll.components.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const sp = new URL(request.url).searchParams;
  const isActiveRaw = sp.get("isActive");
  const kindRaw = sp.get("kind");
  const isActive = isActiveRaw ? z.enum(["true", "false"]).parse(isActiveRaw) === "true" : undefined;
  const kind = kindRaw ? z.enum(["earning", "deduction"]).parse(kindRaw) : undefined;
  return NextResponse.json({ data: await listComponents(actor, { isActive, kind }) });
});

/** Buat komponen gaji. Izin: payroll.components.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const input = createComponentSchema.parse(await readJson(request));
  return NextResponse.json({ data: await createComponent(actor, input) }, { status: 201 });
});
