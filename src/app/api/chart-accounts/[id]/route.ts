import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getChartAccount,
  updateChartAccount,
} from "@/modules/accounting/chart-account-service";
import { updateChartAccountSchema } from "@/modules/accounting/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };

const idSchema = z.uuid();

async function parseAccountId(context: IdContext): Promise<string> {
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);

  // Format id yang salah diperlakukan sebagai tidak ditemukan, bukan 500 dari database.
  if (!parsed.success) {
    throw notFound("Akun tidak ditemukan.");
  }
  return parsed.data;
}

/** Detail akun. Izin: accounting.accounts.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseAccountId(context);

  const account = await getChartAccount(actor, id);
  return NextResponse.json({ data: account });
});

/**
 * Mengubah nama, induk, isPostable, isActive, dan/atau description.
 * Izin: accounting.accounts.manage.
 * `code` dan `type` tidak dapat diubah (dijaga juga oleh trigger DB).
 * Tidak ada DELETE: akun hanya dinonaktifkan.
 */
export const PATCH = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseAccountId(context);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = updateChartAccountSchema.parse(body);
  const account = await updateChartAccount(actor, id, input);

  return NextResponse.json({ data: account });
});