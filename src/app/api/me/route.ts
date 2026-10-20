import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { roles, userRoles } from "@/db/schema";
import { loadGrants, requireSession, type Grant } from "@/server/authz";
import { db } from "@/server/db";
import { apiHandler } from "@/server/errors";

type PermissionSummary = { code: string; global: boolean; branchIds: string[] };

/** Meringkas grant per kode permission: berlaku global dan/atau pada cabang tertentu. */
function summarizeGrants(grants: readonly Grant[]): PermissionSummary[] {
  const byCode = new Map<string, PermissionSummary>();

  for (const grant of grants) {
    const entry = byCode.get(grant.code) ?? { code: grant.code, global: false, branchIds: [] };

    if (grant.branchId === null) {
      entry.global = true;
    } else if (!entry.branchIds.includes(grant.branchId)) {
      entry.branchIds.push(grant.branchId);
    }

    byCode.set(grant.code, entry);
  }

  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export const GET = apiHandler(async () => {
  const actor = await requireSession();

  const [grants, assignedRoles] = await Promise.all([
    loadGrants(actor.userId),
    db
      .select({ code: roles.code, name: roles.name, branchId: userRoles.branchId })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, actor.userId))
      .orderBy(roles.code),
  ]);

  return NextResponse.json(
    {
      authenticated: true,
      user: { id: actor.userId, name: actor.name, email: actor.email },
      roles: assignedRoles,
      permissions: summarizeGrants(grants),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});