import { NextResponse } from "next/server";

import { getMyLeave } from "@/modules/hr/self-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/** Saldo & pengajuan cuti milik karyawan pemakai sesi. Izin: hr.self.view */
export const GET = apiHandler(async () => {
  const actor = await requireActor();
  return NextResponse.json({ data: await getMyLeave(actor) });
});
