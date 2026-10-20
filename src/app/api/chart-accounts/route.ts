import { NextResponse } from "next/server";

import {
  createChartAccount,
  listChartAccounts,
} from "@/modules/accounting/chart-account-service";
import {
  createChartAccountSchema,
  listChartAccountsQuerySchema,
} from "@/modules/accounting/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/**
 * Daftar bagan akun (datar, pohon disusun lewat parentId oleh pemanggil).
 * Filter: ?isActive=true|false, ?isPostable=true|false, ?type=asset|liability|equity|revenue|expense
 * Izin: accounting.accounts.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = listChartAccountsQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await listChartAccounts(actor, query);

  return NextResponse.json({ data });
});

/** Membuat akun baru. Izin: accounting.accounts.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = createChartAccountSchema.parse(body);
  const account = await createChartAccount(actor, input);

  return NextResponse.json({ data: account }, { status: 201 });
});