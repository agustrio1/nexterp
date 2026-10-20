import { NextResponse } from "next/server";

import { createSupplierInvoice, listSupplierInvoices } from "@/modules/purchasing/invoice-service";
import {
  createSupplierInvoiceSchema,
  listSupplierInvoicesQuerySchema,
} from "@/modules/purchasing/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/**
 * Daftar invoice pemasok (AP). Filter: ?status, ?supplierId, ?poId.
 * Izin: purchasing.invoices.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = listSupplierInvoicesQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await listSupplierInvoices(actor, query);
  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});

/** Membuat invoice pemasok draft (three-way match ke PO). Izin: purchasing.invoices.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = createSupplierInvoiceSchema.parse(body);
  const data = await createSupplierInvoice(actor, input);
  return NextResponse.json({ data }, { status: 201 });
});
