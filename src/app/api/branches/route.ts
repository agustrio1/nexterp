import { NextResponse } from "next/server";

import { createBranch, listBranches } from "@/modules/organization/branch-service";
import { createBranchSchema, listBranchesQuerySchema } from "@/modules/organization/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/** Daftar cabang, opsional ?isActive=true|false. Izin: core.branches.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = listBranchesQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await listBranches(actor, query);

  return NextResponse.json({ data });
});

/** Membuat cabang baru. Izin: core.branches.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = createBranchSchema.parse(body);
  const branch = await createBranch(actor, input);

  return NextResponse.json({ data: branch }, { status: 201 });
});