import { NextResponse } from "next/server";

import { updateUserSchema } from "@/modules/users/schemas";
import { getUser, updateUser } from "@/modules/users/service";
import { requirePermission } from "@/server/authz";
import { apiHandler } from "@/server/errors";
import { idParamsSchema, parseBody, parseParams } from "@/server/validation";

type RouteContext = { params: Promise<{ id: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

export const GET = apiHandler(async (_request: Request, context: RouteContext) => {
  const actor = await requirePermission("core.users.read");
  const { id } = await parseParams(context.params, idParamsSchema);

  const user = await getUser(actor, id);
  return NextResponse.json({ user }, { headers: NO_STORE });
});

export const PATCH = apiHandler(async (request: Request, context: RouteContext) => {
  const actor = await requirePermission("core.users.update");
  const { id } = await parseParams(context.params, idParamsSchema);
  const input = await parseBody(request, updateUserSchema);

  const user = await updateUser(actor, id, input);
  return NextResponse.json({ user }, { headers: NO_STORE });
});