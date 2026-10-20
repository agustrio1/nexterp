import { NextResponse } from "next/server";

import {
  createSupplier,
  listSuppliers,
} from "@/modules/purchasing/supplier-service";
import { createSupplierSchema, listSuppliersQuerySchema } from "@/modules/purchasing/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/** Daftar pemasok. Filter: ?isActive, ?search. Izin: purchasing.suppliers.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const query = listSuppliersQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await listSuppliers(actor, query);
  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});

/** Membuat pemasok. Izin: purchasing.suppliers.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }
  const input = createSupplierSchema.parse(body);
  const data = await createSupplier(actor, input);
  return NextResponse.json({ data }, { status: 201 });
});
