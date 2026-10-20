import { NextResponse } from "next/server";

import { createPosition, listPosition } from "@/modules/hr/position-service";
import { createPositionSchema, listPositionsQuerySchema } from "@/modules/hr/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/** Daftar jabatan. Izin: hr.positions.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = listPositionsQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const data = await listPosition(actor, query);
  return NextResponse.json({ data });
});

/** Buat jabatan. Izin: hr.positions.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = createPositionSchema.parse(body);
  const data = await createPosition(actor, input);
  return NextResponse.json({ data }, { status: 201 });
});
