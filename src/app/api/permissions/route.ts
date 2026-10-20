import { NextResponse } from "next/server";

import { listPermissions } from "@/modules/roles/service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/** Daftar permission dikelompokkan per modul. Izin: core.permissions.read */
export const GET = apiHandler(async () => {
  const actor = await requireActor();
  const data = await listPermissions(actor);

  return NextResponse.json({ data });
});