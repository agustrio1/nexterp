import { z } from "zod";
import { NextResponse } from "next/server";

import { createEnrollment, listEnrollments } from "@/modules/hr/training-service";
import { createEnrollmentSchema } from "@/modules/hr/schemas";
import { readJson } from "@/app/api/hr/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/** Daftar pendaftaran pelatihan, opsional ?programId=<uuid>. Izin: hr.training.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const raw = new URL(request.url).searchParams.get("programId");
  const programId = raw ? z.uuid().parse(raw) : undefined;
  return NextResponse.json({ data: await listEnrollments(actor, programId) });
});

/** Daftarkan karyawan ke program. Izin: hr.training.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const input = createEnrollmentSchema.parse(await readJson(request));
  return NextResponse.json({ data: await createEnrollment(actor, input) }, { status: 201 });
});
