import { NextResponse } from "next/server";

import {
  createApprovalWorkflow,
  listApprovalWorkflows,
} from "@/modules/core/approval-service";
import {
  createApprovalWorkflowSchema,
  listApprovalWorkflowsQuerySchema,
} from "@/modules/core/approval-schemas";
import { requireActor } from "@/server/auth/actor";
import { apiHandler, validationFailed } from "@/server/errors";

/**
 * Daftar alur persetujuan (datar). Filter: ?docType=..., ?isActive=true|false
 * Izin: core.approval_workflows.read
 */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  const query = listApprovalWorkflowsQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const data = await listApprovalWorkflows(actor, query);

  return NextResponse.json({ data });
});

/**
 * Membuat alur beserta langkahnya (deklaratif, steps di dalam body).
 * Izin: core.approval_workflows.manage
 */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireActor();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationFailed([{ path: "", message: "Body harus berupa JSON yang valid." }]);
  }

  const input = createApprovalWorkflowSchema.parse(body);
  const workflow = await createApprovalWorkflow(actor, input);

  return NextResponse.json({ data: workflow }, { status: 201 });
});
