import { NextResponse } from "next/server";

import {
  createDraftJournal,
  listJournals,
} from "@/modules/accounting/journal-service";
import {
  createJournalSchema,
  listJournalsQuerySchema,
} from "@/modules/accounting/schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/**
 * Daftar jurnal (header saja) dengan keyset pagination.
 * Query: ?status=draft|posted|reversed|cancelled, ?dateFrom, ?dateTo (YYYY-MM-DD),
 * ?accountId, ?branchId, ?departmentId, ?limit, ?cursor.
 * Izin: accounting.journals.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = listJournalsQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const { items, nextCursor } = await listJournals(actor, query);

  return NextResponse.json(
    { data: items, meta: { nextCursor } },
    { headers: { "Cache-Control": "no-store" } },
  );
});

/**
 * Membuat jurnal draf. Draf tidak diberi nomor; nomor, periode, dan totals terisi
 * saat POST /api/journals/[id]/post. Izin: accounting.journals.create
 */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = createJournalSchema.parse(body);
  const journal = await createDraftJournal(actor, input);

  return NextResponse.json({ data: journal }, { status: 201 });
});