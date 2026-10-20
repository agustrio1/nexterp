import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getApprovalWorkflow,
  updateApprovalWorkflow,
} from "@/modules/core/approval-service";
import { updateApprovalWorkflowSchema } from "@/modules/core/approval-schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, notFound, validationFailed } from "@/server/errors";

type IdContext = { params: Promise<{ id: string }> };

const idSchema = z.uuid();

async function parseWorkflowId(context: IdContext): Promise<string> {
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound("Alur persetujuan tidak ditemukan.");
  return parsed.data;
}

/** Detail alur beserta langkahnya. Izin: core.approval_workflows.read */
export const GET = apiHandler(async (_request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseWorkflowId(context);

  const workflow = await getApprovalWorkflow(actor, id);
  return NextResponse.json({ data: workflow });
});

/**
 * Mengubah properti alur dan/atau mengganti seluruh langkah (bila `steps` diisi).
 * Izin: core.approval_workflows.manage. Tidak ada DELETE (nonaktifkan lewat isActive).
 */
export const PATCH = apiHandler(async (request: Request, context: IdContext) => {
  const actor = await requireActor();
  const id = await parseWorkflowId(context);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = updateApprovalWorkflowSchema.parse(body);
  const workflow = await updateApprovalWorkflow(actor, id, input);

  return NextResponse.json({ data: workflow });
});
