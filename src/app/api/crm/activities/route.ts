import { NextResponse } from "next/server";
import { z } from "zod";

import { createActivity, listActivities } from "@/modules/crm/activity-service";
import { createActivitySchema } from "@/modules/crm/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

const listQuerySchema = z.object({
  accountId: z.uuid().optional(),
  opportunityId: z.uuid().optional(),
});

/** Daftar aktivitas, opsional ?accountId=&opportunityId=. Izin: crm.activities.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const filters = listQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await listActivities(actor, filters);
  return NextResponse.json({ data });
});

/** Mencatat aktivitas baru. Izin: crm.activities.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  let body: unknown;
  try { body = await request.json(); } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = createActivitySchema.parse(body);
  const data = await createActivity(actor, input);
  return NextResponse.json({ data }, { status: 201 });
});
