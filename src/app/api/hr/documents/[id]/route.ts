import { NextResponse } from "next/server";

import { deleteDocument, getDocument, updateDocument } from "@/modules/hr/document-service";
import { updateDocumentSchema } from "@/modules/hr/schemas";
import { readId, readJson } from "@/app/api/hr/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

type Ctx = { params: Promise<{ id: string }> };

/** Detail dokumen. Izin: hr.documents.read */
export const GET = apiHandler(async (_request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Dokumen");
  return NextResponse.json({ data: await getDocument(actor, id) });
});

/** Ubah dokumen. Izin: hr.documents.manage */
export const PATCH = apiHandler(async (request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Dokumen");
  const input = updateDocumentSchema.parse(await readJson(request));
  return NextResponse.json({ data: await updateDocument(actor, id, input) });
});

/** Hapus dokumen (metadata). Izin: hr.documents.manage */
export const DELETE = apiHandler(async (_request: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const id = await readId(ctx, "Dokumen");
  return NextResponse.json({ data: await deleteDocument(actor, id) });
});
