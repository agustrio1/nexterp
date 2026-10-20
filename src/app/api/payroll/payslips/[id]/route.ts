import { z } from "zod";
import { NextResponse } from "next/server";

import { getPayslip, voidPayslip } from "@/modules/payroll/payslip-service";
import { readId, readJson } from "@/app/api/payroll/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

type Ctx = { params: Promise<{ id: string }> };
const voidSchema = z.strictObject({ reason: z.string().trim().min(3).max(500) });

/** Detail slip gaji. Izin: payroll.payslips.read */
export const GET = apiHandler(async (_request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Slip gaji");
  return NextResponse.json({ data: await getPayslip(actor, id) });
});

/** Batalkan slip (issued -> void). Izin: payroll.payslips.read */
export const POST = apiHandler(async (request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Slip gaji");
  const { reason } = voidSchema.parse(await readJson(request));
  return NextResponse.json({ data: await voidPayslip(actor, id, reason) });
});
