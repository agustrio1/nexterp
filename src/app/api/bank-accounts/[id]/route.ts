import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getBankAccount,
  updateBankAccount,
} from "@/modules/accounting/bank-account-service";
import { updateBankAccountSchema } from "@/modules/accounting/cash-schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/** Detail rekening kas/bank. Izin: accounting.bank_accounts.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Rekening kas/bank tidak ditemukan.");

  const data = await getBankAccount(actor, parsed.data);
  return NextResponse.json({ data });
});

/** Memperbarui rekening kas/bank (termasuk menonaktifkan). Izin: accounting.bank_accounts.manage */
export const PATCH = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Rekening kas/bank tidak ditemukan.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = updateBankAccountSchema.parse(body);
  const data = await updateBankAccount(actor, parsed.data, input);

  return NextResponse.json({ data });
});
