import { NextResponse } from "next/server";
import { z } from "zod";

import { postReturn } from "@/modules/sales/return-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/** Posting retur: masukkan stok kembali, jurnal Dr Persediaan / Cr HPP, terbitkan nomor. Izin: sales.returns.manage */
export const POST = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) throw notFound("Retur tidak ditemukan.");
  const data = await postReturn(actor, id);
  return NextResponse.json({ data });
});
