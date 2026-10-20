import { NextResponse } from "next/server";

import { replaceUserRolesSchema } from "@/modules/users/schemas";
import { replaceUserRoles } from "@/modules/users/service";
import { requirePermission } from "@/server/authz";
import { apiHandler } from "@/server/errors";
import { idParamsSchema, parseBody, parseParams } from "@/server/validation";

type RouteContext = { params: Promise<{ id: string }> };

export const PUT = apiHandler(async (request: Request, context: RouteContext) => {
  const actor = await requirePermission("core.users.update");
  const { id } = await parseParams(context.params, idParamsSchema);
  const input = await parseBody(request, replaceUserRolesSchema);

  const user = await replaceUserRoles(actor, id, input);
  return NextResponse.json({ user }, { headers: { "Cache-Control": "no-store" } });
});