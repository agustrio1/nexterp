import { NextResponse } from "next/server";

import { getMyProfile } from "@/modules/hr/self-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/** Profil karyawan milik pemakai sesi. Izin: hr.self.view */
export const GET = apiHandler(async () => {
  const actor = await requireActor();
  return NextResponse.json({ data: await getMyProfile(actor) });
});
