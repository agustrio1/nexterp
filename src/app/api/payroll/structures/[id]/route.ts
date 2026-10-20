import { NextResponse } from "next/server";

import { getStructure, updateStructure } from "@/modules/payroll/structure-service";
import { updateStructureSchema } from "@/modules/payroll/schemas";
import { readId, readJson } from "@/app/api/payroll/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

type Ctx = { params: Promise<{ id: string }> };

/** Detail struktur + komponen. Izin: payroll.structures.read */
export const GET = apiHandler(async (_request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Struktur");
  return NextResponse.json({ data: await getStructure(actor, id) });
});

/** Ubah struktur. Izin: payroll.structures.manage */
export const PATCH = apiHandler(async (request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Struktur");
  const input = updateStructureSchema.parse(await readJson(request));
  return NextResponse.json({ data: await updateStructure(actor, id, input) });
});
