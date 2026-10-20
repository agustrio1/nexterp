import { z } from "zod";
import { NextResponse } from "next/server";

import { approveRun, calculateRun, cancelRun, postRun, reverseRun } from "@/modules/payroll/run-service";
import { readId, readJson } from "@/app/api/payroll/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

type Ctx = { params: Promise<{ id: string }> };
const actionSchema = z.strictObject({
  action: z.enum(["calculate", "approve", "post", "cancel", "reverse"]),
  reason: z.string().trim().min(3).max(500).optional(),
});

/** Transisi run: calculate | approve | post | cancel | reverse. */
export const POST = apiHandler(async (request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Run");
  const { action, reason } = actionSchema.parse(await readJson(request));

  if (action === "cancel" || action === "reverse") {
    if (!reason) {
      throw validationFailed([{ path: "reason", message: "Alasan wajib diisi untuk membatalkan/membalikkan run." }]);
    }
    const data =
      action === "cancel" ? await cancelRun(actor, id, reason) : await reverseRun(actor, id, reason);
    return NextResponse.json({ data });
  }

  const data =
    action === "calculate"
      ? await calculateRun(actor, id)
      : action === "approve"
        ? await approveRun(actor, id)
        : await postRun(actor, id);
  return NextResponse.json({ data });
});
