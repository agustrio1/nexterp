import { NextResponse } from "next/server";

import { createCustomer, listCustomers } from "@/modules/crm/customer-service";
import { createCustomerSchema, listQuerySchema } from "@/modules/crm/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/** Daftar pelanggan, opsional ?isActive=&search=. Izin: crm.customers.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = listQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await listCustomers(actor, query);
  return NextResponse.json({ data });
});

/** Membuat pelanggan baru. Izin: crm.customers.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  let body: unknown;
  try { body = await request.json(); } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = createCustomerSchema.parse(body);
  const data = await createCustomer(actor, input);
  return NextResponse.json({ data }, { status: 201 });
});
