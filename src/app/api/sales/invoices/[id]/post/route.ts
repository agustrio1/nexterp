import { NextResponse } from "next/server";
import { z } from "zod";

import { postInvoice } from "@/modules/sales/invoice-service";
import { postInvoiceSchema } from "@/modules/sales/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/** Posting faktur: kunci kurs, hitung PPN (jika taxId diisi), jurnal Dr AR / Cr Revenue + Cr Tax. Izin: sales.invoices.post */
export const POST = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) throw notFound("Faktur tidak ditemukan.");
  let taxId: string | null = null;
  const raw = await request.text();
  if (raw.trim().length > 0) {
    let body: unknown;
    try { body = JSON.parse(raw); } catch {
      throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
    }
    taxId = postInvoiceSchema.parse(body).taxId ?? null;
  }
  const data = await postInvoice(actor, id, taxId);
  return NextResponse.json({ data });
});
