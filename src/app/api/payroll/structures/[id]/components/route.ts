import { NextResponse } from "next/server";

import { setStructureComponents } from "@/modules/payroll/structure-service";
import { attachComponentsSchema } from "@/modules/payroll/schemas";
import { readId, readJson } from "@/app/api/payroll/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

type Ctx = { params: Promise<{ id: string }> };

/** Ganti keanggotaan komponen struktur (replace-semantik). Izin: payroll.structures.manage */
export const POST = apiHandler(async (request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Struktur");
  const input = attachComponentsSchema.parse(await readJson(request));
  return NextResponse.json({ data: await setStructureComponents(actor, id, input) });
});
