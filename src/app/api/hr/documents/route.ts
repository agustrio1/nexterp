import { z } from "zod";
import { NextResponse } from "next/server";

import { createDocument, listDocuments } from "@/modules/hr/document-service";
import { createDocumentSchema } from "@/modules/hr/schemas";
import { readJson } from "@/app/api/hr/_helpers";
import { requireActor } from "@/server/auth/actor";
import { apiHandler } from "@/server/errors";

/** Daftar dokumen karyawan via ?employeeId=<uuid>. Izin: hr.documents.read */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const raw = new URL(request.url).searchParams.get("employeeId");
  const employeeId = raw ? z.uuid().parse(raw) : undefined;
  return NextResponse.json({ data: await listDocuments(actor, employeeId ?? "") });
});

/** Catat dokumen. Izin: hr.documents.manage */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();
  const input = createDocumentSchema.parse(await readJson(request));
  return NextResponse.json({ data: await createDocument(actor, input) }, { status: 201 });
});
