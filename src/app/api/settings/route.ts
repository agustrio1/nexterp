import { NextResponse } from "next/server";

import { getSettings, updateSettings } from "@/modules/organization/company-service";
import { updateSettingsSchema } from "@/modules/organization/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/** Seluruh pengaturan aplikasi; editable = false berarti hanya dibaca. Izin: core.settings.read */
export const GET = apiHandler(async () => {
  const actor = await requireActor();
  const data = await getSettings(actor);

  return NextResponse.json({ data });
});

/** Mengubah timezone dan/atau allow_negative_stock. Izin: core.settings.update */
export const PATCH = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = updateSettingsSchema.parse(body);
  const data = await updateSettings(actor, input);

  return NextResponse.json({ data });
});