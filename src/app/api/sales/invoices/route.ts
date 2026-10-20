import { NextResponse } from "next/server";

import { createInvoice, listInvoices } from "@/modules/sales/invoice-service";
import { createCustomerInvoiceSchema, listSalesQuerySchema } from "@/modules/sales/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/** Daftar faktur penjualan, opsional ?status=&customerId=&branchId=. Izin: sales.invoices.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = listSalesQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const data = await listInvoices(actor, query);
  return NextResponse.json({ data });
});

/** Membuat faktur penjualan baru (draft) dari pengiriman posted. Izin: sales.invoices.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  let body: unknown;
  try { body = await request.json(); } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = createCustomerInvoiceSchema.parse(body);
  const data = await createInvoice(actor, input);
  return NextResponse.json({ data }, { status: 201 });
});
