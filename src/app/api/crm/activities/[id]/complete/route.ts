import { NextResponse } from "next/server";
import { z } from "zod";

import { completeActivity, getActivity } from "@/modules/crm/activity-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

async function parseId(context: IdContext): Promise<string> {
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Aktivitas tidak ditemukan.");
  return parsed.data;
}

/** Detail aktivitas. Izin: crm.activities.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  const data = await getActivity(actor, id);
  return NextResponse.json({ data });
});

/** Tandai aktivitas selesai. Izin: crm.activities.manage */
export const POST = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseId(context);
  const data = await completeActivity(actor, id);
  return NextResponse.json({ data });
});
