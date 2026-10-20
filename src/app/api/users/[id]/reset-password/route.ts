import { NextResponse } from "next/server";

import { resetUserPasswordSchema } from "@/modules/users/schemas";
import { resetUserPassword } from "@/modules/users/service";
import { requirePermission } from "@/server/authz";
import { apiHandler } from "@/server/errors";
import { idParamsSchema, parseBody, parseParams } from "@/server/validation";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = apiHandler(async (request: Request, context: RouteContext) => {
  const actor = await requirePermission("core.users.update");
  const { id } = await parseParams(context.params, idParamsSchema);
  const input = await parseBody(request, resetUserPasswordSchema);

  await resetUserPassword(actor, id, input.password);
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
});