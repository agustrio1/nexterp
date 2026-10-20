import { NextResponse } from "next/server";

import { listAuditLogsQuerySchema } from "@/modules/audit/schemas";
import { listAuditLogs } from "@/modules/audit/service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/**
 * Daftar audit log (hanya baca), terbaru dulu, paginasi kursor.
 * Filter: ?action, ?actionPrefix, ?entityType, ?entityId, ?actorId, ?dateFrom, ?dateTo
 * (YYYY-MM-DD, menurut zona waktu perusahaan), ?limit, ?cursor.
 * Izin: core.audit_logs.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = listAuditLogsQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const { items, nextCursor } = await listAuditLogs(actor, query);

  return NextResponse.json(
    { data: items, meta: { nextCursor } },
    { headers: { "Cache-Control": "no-store" } },
  );
});