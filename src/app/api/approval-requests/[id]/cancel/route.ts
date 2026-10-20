import { NextResponse } from "next/server";
import { z } from "zod";

import { cancelApproval } from "@/modules/core/approval-service";
import { cancelApprovalSchema } from "@/modules/core/approval-schemas";
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
 * Membatalkan pengajuan `pending`. Pengaju boleh menarik sendiri; pihak lain butuh
 * izin core.approvals.cancel. Body opsional: { reason? }.
 */
export const POST = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseRequestId(context);

  let body: unknown = {};
  try {
    const text = await request.text();
    body = text === "" ? {} : JSON.parse(text);
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = cancelApprovalSchema.parse(body);
  const data = await cancelApproval(actor, id, input);

  return NextResponse.json({ data });
});
