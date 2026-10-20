import { z } from "zod";
import { NextResponse } from "next/server";

import { getMyAttendance } from "@/modules/hr/self-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

const dateSchema = z.iso.date();

/** Absensi milik karyawan pemakai sesi, opsional ?from=&to=<YYYY-MM-DD>. Izin: hr.self.view */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const params = new URL(request.url).searchParams;
  const rawFrom = params.get("from");
  const rawTo = params.get("to");
  const range = {
    from: rawFrom ? dateSchema.parse(rawFrom) : undefined,
    to: rawTo ? dateSchema.parse(rawTo) : undefined,
  };
  return NextResponse.json({ data: await getMyAttendance(actor, range) });
});
