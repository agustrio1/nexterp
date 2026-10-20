import { NextResponse } from "next/server";
import { z } from "zod";

import { createOpportunity, listOpportunities } from "@/modules/crm/opportunity-service";
import { createOpportunitySchema } from "@/modules/crm/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

const listQuerySchema = z.object({
  accountId: z.uuid().optional(),
  status: z.string().optional(),
});

/** Daftar peluang, opsional ?accountId=&status=. Izin: crm.opportunities.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const filters = listQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await listOpportunities(actor, filters);
  return NextResponse.json({ data });
});

/** Membuat peluang baru. Izin: crm.opportunities.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  let body: unknown;
  try { body = await request.json(); } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = createOpportunitySchema.parse(body);
  const data = await createOpportunity(actor, input);
  return NextResponse.json({ data }, { status: 201 });
});
