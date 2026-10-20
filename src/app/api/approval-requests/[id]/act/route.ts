import { NextResponse } from "next/server";
import { z } from "zod";

import { actOnApproval } from "@/modules/core/approval-service";
import { actApprovalSchema } from "@/modules/core/approval-schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };

const idSchema = z.uuid();

async function parseRequestId(context: IdContext): Promise<string> {
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Permintaan persetujuan tidak ditemukan.");
  return parsed.data;
}

/**
 * Menyetujui atau menolak langkah aktif permintaan. Hanya approver langkah aktif yang
 * boleh bertindak; pengaju tidak boleh menyetujui pengajuannya sendiri (SoD).
 * Izin: core.approvals.act
 */
export const POST = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseRequestId(context);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = actApprovalSchema.parse(body);
  const data = await actOnApproval(actor, id, input);

  return NextResponse.json({ data });
});
