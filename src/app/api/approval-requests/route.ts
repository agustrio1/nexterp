import { NextResponse } from "next/server";

import { listApprovalRequests, submitApproval } from "@/modules/core/approval-service";
import { listApprovalRequestsQuerySchema, submitApprovalSchema } from "@/modules/core/approval-schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/**
 * Daftar permintaan persetujuan (keyset, terbaru dulu).
 * Query: ?status=pending|approved|rejected|cancelled, ?docType, ?docId,
 * ?forMe=true (menunggu tindakan saya), ?limit, ?cursor.
 * Izin: core.approvals.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = listApprovalRequestsQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const { items, nextCursor } = await listApprovalRequests(actor, query);

  return NextResponse.json(
    { data: items, meta: { nextCursor } },
    { headers: { "Cache-Control": "no-store" } },
  );
});

/**
 * Mengajukan dokumen untuk persetujuan. Alur dicocokkan otomatis dari
 * docType + (opsional) cabang + (opsional) nominal. Izin: core.approvals.request
 */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = submitApprovalSchema.parse(body);
  const result = await submitApproval(actor, input);

  return NextResponse.json({ data: result }, { status: 201 });
});
