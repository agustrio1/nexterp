import { NextResponse } from "next/server";
import { z } from "zod";

import { getJobArtifact } from "@/modules/jobs/job-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { parseParams } from "@/server/validation";

const paramsSchema = z.object({ jobId: z.uuid("ID tidak valid.") });

type Context = { params: Promise<{ jobId: string }> };

/**
 * Unduh artefak CSV satu job selesai. Respons berupa berkas (bukan envelope
 * JSON) agar bisa dipakai langsung oleh browser. Izin: reporting.exports.read
 */
export const GET = apiHandler(async (_request: Request, context: Context) => {
  const actor = await requireActor();
  const { jobId } = await parseParams(context.params, paramsSchema);
  const artifact = await getJobArtifact(actor, jobId);

  return new NextResponse(artifact.text, {
    headers: {
      "Content-Type": artifact.contentType,
      "Content-Disposition": `attachment; filename="${artifact.fileName}"`,
      "Cache-Control": "no-store",
    },
  });
});
