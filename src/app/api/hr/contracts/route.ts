import { z } from "zod";
import { NextResponse } from "next/server";

import { createContract, listContracts } from "@/modules/hr/contract-service";
import { createContractSchema } from "@/modules/hr/schemas";
import { readJson } from "@/app/api/hr/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/** Daftar kontrak, opsional ?employeeId=<uuid>. Izin: hr.contracts.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const raw = new URL(request.url).searchParams.get("employeeId");
  const employeeId = raw ? z.uuid().parse(raw) : undefined;
  return NextResponse.json({ data: await listContracts(actor, employeeId) });
});

/** Buat kontrak (docNo dibuat otomatis). Izin: hr.contracts.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const input = createContractSchema.parse(await readJson(request));
  return NextResponse.json({ data: await createContract(actor, input) }, { status: 201 });
});
