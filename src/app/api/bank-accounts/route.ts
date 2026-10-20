import { NextResponse } from "next/server";

import {
  createBankAccount,
  listBankAccounts,
} from "@/modules/accounting/bank-account-service";
import {
  createBankAccountSchema,
  listBankAccountsQuerySchema,
} from "@/modules/accounting/cash-schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/**
 * Daftar rekening kas/bank.
 * Filter: ?isActive=true|false, ?kind=cash|bank, ?branchId=<uuid>
 * Izin: accounting.bank_accounts.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = listBankAccountsQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await listBankAccounts(actor, query);

  return NextResponse.json({ data });
});

/** Membuat rekening kas/bank. Izin: accounting.bank_accounts.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = createBankAccountSchema.parse(body);
  const data = await createBankAccount(actor, input);

  return NextResponse.json({ data }, { status: 201 });
});
