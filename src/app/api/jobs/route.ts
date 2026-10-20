import { NextResponse } from "next/server";

import { listJobs } from "@/modules/jobs/job-service";
import { listJobsQuerySchema } from "@/modules/jobs/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { parseQuery } from "@/server/validation";

/**
 * Daftar job latar belakang (terbaru duluan). Enqueue tidak di sini:
 * pembuatan ekspor lewat POST /api/reports/export karena jenis job saat ini
 * hanya ekspor laporan. Filter: ?status, ?type, ?createdBy, ?limit, ?cursor.
 * Paginasi: keyset opaque cursor (Tahap 10C).
 * Izin: reporting.exports.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = parseQuery(request, listJobsQuerySchema);
  const { items, nextCursor, hasMore } = await listJobs(actor, query);

  return NextResponse.json(
    { data: items, meta: { limit: query.limit, cursor: query.cursor ?? null, nextCursor, hasMore } },
    { headers: { "Cache-Control": "no-store" } },
  );
});
