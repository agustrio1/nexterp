import { NextResponse } from "next/server";

import { getMyOvertime } from "@/modules/hr/self-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/** Pengajuan lembur milik karyawan pemakai sesi. Izin: hr.self.view */
export const GET = apiHandler(async () => {
  const actor = await requireActor();
  return NextResponse.json({ data: await getMyOvertime(actor) });
});
