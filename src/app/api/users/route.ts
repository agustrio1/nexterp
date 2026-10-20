import { NextResponse } from "next/server";
import { z } from "zod";

import { createUserSchema, USER_STATUSES } from "@/modules/users/schemas";
import { createUser, listUsers } from "@/modules/users/service";
import { requirePermission } from "@/server/authz";
import { apiHandler } from "@/server/errors";
import { paginationSchema, parseBody, parseQuery } from "@/server/validation";

const listQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(USER_STATUSES).optional(),
});

const NO_STORE = { "Cache-Control": "no-store" };

export const GET = apiHandler(async (request: Request) => {
  const actor = await requirePermission("core.users.read");
  const query = parseQuery(request, listQuerySchema);

  const result = await listUsers(actor, query);
  return NextResponse.json(result, { headers: NO_STORE });
});

export const POST = apiHandler(async (request: Request) => {
  const actor = await requirePermission("core.users.create");
  const input = await parseBody(request, createUserSchema);

  const user = await createUser(actor, input);
  return NextResponse.json(
    { user },
    { status: 201, headers: { ...NO_STORE, Location: `/api/users/${user.id}` } },
  );
});