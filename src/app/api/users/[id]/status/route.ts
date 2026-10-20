import { NextResponse } from "next/server";

import { setUserStatusSchema } from "@/modules/users/schemas";
import { setUserStatus } from "@/modules/users/service";
import { requirePermission } from "@/server/authz";
import { apiHandler } from "@/server/errors";
import { idParamsSchema, parseBody, parseParams } from "@/server/validation";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = apiHandler(async (request: Request, context: RouteContext) => {
  const actor = await requirePermission("core.users.deactivate");
  const { id } = await parseParams(context.params, idParamsSchema);
  const input = await parseBody(request, setUserStatusSchema);

  const user = await setUserStatus(actor, id, input.status);
  return NextResponse.json({ user }, { headers: { "Cache-Control": "no-store" } });
});