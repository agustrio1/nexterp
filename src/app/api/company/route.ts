import { NextResponse } from "next/server";

import { getCompanyProfile, saveCompanyProfile } from "@/modules/organization/company-service";
import { saveCompanyProfileSchema } from "@/modules/organization/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/** Profil perusahaan; data bernilai null bila belum pernah disimpan. Izin: core.company.read */
export const GET = apiHandler(async () => {
  const actor = await requireActor();
  const data = await getCompanyProfile(actor);

  return NextResponse.json({ data });
});

/**
 * Membuat atau menimpa profil perusahaan (satu baris). Izin: core.company.update
 * Field yang tidak dikirim dianggap kosong.
 */
export const PUT = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = saveCompanyProfileSchema.parse(body);
  const data = await saveCompanyProfile(actor, input);

  return NextResponse.json({ data });
});