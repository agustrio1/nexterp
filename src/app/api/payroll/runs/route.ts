import { z } from "zod";
import { NextResponse } from "next/server";

import { createRun, listRuns } from "@/modules/payroll/run-service";
import { enqueuePayrollRun } from "@/modules/jobs/job-service";
import { createRunSchema } from "@/modules/payroll/schemas";
import { readJson, readUuidParam } from "@/app/api/payroll/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/** Daftar run payroll. ?periodId=, ?status=. Izin: payroll.runs.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const sp = new URL(request.url).searchParams;
  const statusRaw = sp.get("status");
  const status = statusRaw
    ? z.enum(["draft", "calculated", "approved", "posted", "cancelled", "reversed"]).parse(statusRaw)
    : undefined;
  return NextResponse.json({ data: await listRuns(actor, { periodId: readUuidParam(sp.get("periodId")), status }) });
});

/**
 * Buat run payroll (draft) untuk periode/cabang, lalu antrekan kalkulasi
 * latar belakang (Tahap 8E) — run berstatus draft sampai worker menyelesaikan
 * job. Kalkulasi manual tetap tersedia lewat action `calculate`. Izin: payroll.runs.manage
 */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const input = createRunSchema.parse(await readJson(request));
  const run = await createRun(actor, input);
  await enqueuePayrollRun(actor, { runId: run.id });
  return NextResponse.json({ data: run }, { status: 201 });
});
