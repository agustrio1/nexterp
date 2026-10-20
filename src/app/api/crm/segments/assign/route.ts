import { NextResponse } from "next/server";

import { assignSegment } from "@/modules/crm/segment-service";
import { assignSegmentSchema } from "@/modules/crm/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/** Assign akun ke segmen. Izin: crm.segments.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  let body: unknown;
  try { body = await request.json(); } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = assignSegmentSchema.parse(body);
  await assignSegment(actor, input);
  return NextResponse.json({ data: null });
});
