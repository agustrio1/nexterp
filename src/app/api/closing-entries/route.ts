import { NextResponse } from "next/server";

import { createClosingEntrySchema } from "@/modules/accounting/closing-schemas";
import { createClosingEntryDraft } from "@/modules/accounting/closing-service";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/**
 * Membuat draf JURNAL PENUTUP (source `closing_entry`) untuk suatu tahun fiskal.
 * Baris dihitung otomatis (menolkan pendapatan & beban ke akun laba ditahan).
 * Tanggal dipaksa = akhir tahun. Posting lewat POST /api/journals/[id]/post.
 * Izin: accounting.closing.manage
 */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = createClosingEntrySchema.parse(body);
  const draft = await createClosingEntryDraft(actor, input);

  return NextResponse.json({ data: draft }, { status: 201 });
});
