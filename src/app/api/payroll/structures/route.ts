import { z } from "zod";
import { NextResponse } from "next/server";

import { createStructure, listStructures } from "@/modules/payroll/structure-service";
import { createStructureSchema } from "@/modules/payroll/schemas";
import { readJson } from "@/app/api/payroll/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/** Daftar struktur gaji. ?isActive=true|false. Izin: payroll.structures.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const raw = new URL(request.url).searchParams.get("isActive");
  const isActive = raw ? z.enum(["true", "false"]).parse(raw) === "true" : undefined;
  return NextResponse.json({ data: await listStructures(actor, { isActive }) });
});

/** Buat struktur gaji. Izin: payroll.structures.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const input = createStructureSchema.parse(await readJson(request));
  return NextResponse.json({ data: await createStructure(actor, input) }, { status: 201 });
});
