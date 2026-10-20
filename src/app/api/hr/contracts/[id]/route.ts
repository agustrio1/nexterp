import { NextResponse } from "next/server";

import { getContract, updateContract } from "@/modules/hr/contract-service";
import { updateContractSchema } from "@/modules/hr/schemas";
import { readId, readJson } from "@/app/api/hr/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

type Ctx = { params: Promise<{ id: string }> };

/** Detail kontrak. Izin: hr.contracts.read */
export const GET = apiHandler(async (_request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Kontrak");
  return NextResponse.json({ data: await getContract(actor, id) });
});

/** Ubah kontrak. Izin: hr.contracts.manage */
export const PATCH = apiHandler(async (request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Kontrak");
  const input = updateContractSchema.parse(await readJson(request));
  return NextResponse.json({ data: await updateContract(actor, id, input) });
});
