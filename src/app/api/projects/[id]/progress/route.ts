import { NextResponse } from "next/server";

import { updateProgress } from "@/modules/projects/project-service";
import { updateProgressSchema } from "@/modules/projects/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";
import { idParamsSchema, parseBody, parseParams } from "@/server/validation";

type Context = { params: Promise<{ id: string }> };

/**
 * Perbarui progres proyek. Body `{}` = otomatis dari bobot tugas;
 * body `{progressPercent}` = eksplisit. Izin: projects.progress.manage
 */
export const POST = apiHandler(async (request: Request, context: Context) => {
  const actor = await requireActor();
  const { id } = await parseParams(context.params, idParamsSchema);
  const input = await parseBody(request, updateProgressSchema);
  return NextResponse.json({ data: await updateProgress(actor, id, input) });
});
