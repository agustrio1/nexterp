import { NextResponse } from "next/server";

import { createSegment, listSegments } from "@/modules/crm/segment-service";
import { createSegmentSchema } from "@/modules/crm/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/** Daftar segmen. Izin: crm.segments.read */
export const GET = apiHandler(async () => {
  const actor = await requireActor();
  const data = await listSegments(actor);
  return NextResponse.json({ data });
});

/** Membuat segmen baru. Izin: crm.segments.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  let body: unknown;
  try { body = await request.json(); } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = createSegmentSchema.parse(body);
  const data = await createSegment(actor, input);
  return NextResponse.json({ data }, { status: 201 });
});
