import { NextResponse } from "next/server";
import { z } from "zod";

import { getBranch, updateBranch } from "@/modules/organization/branch-service";
import { updateBranchSchema } from "@/modules/organization/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };

const idSchema = z.uuid();

async function parseBranchId(context: IdContext): Promise<string> {
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);

  // Format id yang salah diperlakukan sebagai tidak ditemukan, bukan 500 dari database.
  if (!parsed.success) {
    throw notFound("Cabang tidak ditemukan.");
  }
  return parsed.data;
}

/** Detail cabang. Izin: core.branches.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseBranchId(context);

  const branch = await getBranch(actor, id);
  return NextResponse.json({ data: branch });
});

/**
 * Mengubah nama, alamat, telepon, dan/atau status aktif. Izin: core.branches.manage
 * Kode cabang tidak bisa diubah. Tidak ada DELETE: cabang hanya dinonaktifkan.
 */
export const PATCH = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseBranchId(context);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = updateBranchSchema.parse(body);
  const branch = await updateBranch(actor, id, input);

  return NextResponse.json({ data: branch });
});