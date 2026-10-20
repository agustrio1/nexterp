import { z } from "zod";
import { NextResponse } from "next/server";

import { closePeriod, finalizePeriod, getPeriod, updatePeriod } from "@/modules/payroll/period-service";
import { updatePeriodSchema } from "@/modules/payroll/schemas";
import { readId, readJson } from "@/app/api/payroll/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

type Ctx = { params: Promise<{ id: string }> };
const actionSchema = z.strictObject({ action: z.enum(["finalize", "close"]) });

/** Detail periode. Izin: payroll.periods.read */
export const GET = apiHandler(async (_request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Periode");
  return NextResponse.json({ data: await getPeriod(actor, id) });
});

/** Ubah periode (hanya draft). Izin: payroll.periods.manage */
export const PATCH = apiHandler(async (request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Periode");
  const input = updatePeriodSchema.parse(await readJson(request));
  return NextResponse.json({ data: await updatePeriod(actor, id, input) });
});

/** Transisi status: finalize | close. Izin: payroll.periods.manage */
export const POST = apiHandler(async (request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Periode");
  const { action } = actionSchema.parse(await readJson(request));
  const data = action === "finalize" ? await finalizePeriod(actor, id) : await closePeriod(actor, id);
  return NextResponse.json({ data });
});
