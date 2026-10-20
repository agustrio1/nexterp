import { NextResponse } from "next/server";
import { z } from "zod";

import { getApprovalRequest } from "@/modules/core/approval-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };

const idSchema = z.uuid();

async function parseRequestId(context: IdContext): Promise<string> {
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Permintaan persetujuan tidak ditemukan.");
  return parsed.data;
}

/** Detail permintaan beserta langkah alur dan riwayat aksi. Izin: core.approvals.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseRequestId(context);

  const data = await getApprovalRequest(actor, id);
  return NextResponse.json({ data });
});
