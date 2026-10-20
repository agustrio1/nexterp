import { NextResponse } from "next/server";

import { enqueueExport } from "@/modules/jobs/job-service";
import { enqueueExportSchema } from "@/modules/jobs/schemas";
import { describeExportCatalog } from "@/modules/reporting/export-catalog";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { parseBody } from "@/server/validation";

/**
 * Katalog laporan yang dapat diekspor CSV (key, label, izin sumber).
 * Izin: reporting.exports.read
 */
export const GET = apiHandler(async () => {
  const actor = await requireActor();
  return NextResponse.json(
    { data: describeExportCatalog(actor) },
    { headers: { "Cache-Control": "no-store" } },
  );
});

/**
 * Antrekan job ekspor. Body: { reportKey, query?, idempotencyKey?, runAt?, maxAttempts? }.
 * `query` divalidasi terhadap skema laporan sumber sebelum job dibuat, sehingga
 * permintaan yang salah ditolak lebih awal (bukan setelah job diklaim).
 * Izin: reporting.exports.manage + izin baca laporan sumber
 */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const input = await parseBody(request, enqueueExportSchema);
  const job = await enqueueExport(actor, input);
  return NextResponse.json({ data: job }, { status: 201 });
});
