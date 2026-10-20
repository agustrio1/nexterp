import { eq } from "drizzle-orm";

import { permissions, rolePermissions, userRoles } from "@/db/schema";
import type { PermissionCode } from "@/modules/permissions";
import { db } from "@/server/db";
import { getServerSession } from "@/server/auth/session";
import { forbidden, unauthenticated } from "@/server/errors";

/** Gabungan permission seluruh modul; sumbernya registri di src/modules/permissions.ts. */
export type { PermissionCode };

/** branchId null = izin berlaku di semua cabang. */
export type Grant = { code: string; branchId: string | null };

/**
 * Cakupan pengecekan:
 * - kosong: hanya izin global yang lolos
 * - branchId: izin global atau izin pada cabang tersebut
 * - anyBranch: izin pada cakupan apa pun (untuk endpoint daftar yang difilter per cabang)
 */
export type PermissionScope = { branchId?: string; anyBranch?: boolean };

export type SessionActor = { userId: string; name: string; email: string };
export type AuthContext = SessionActor & { grants: Grant[] };

/** Memuat seluruh izin efektif user dari role yang ditugaskan. */
export async function loadGrants(userId: string): Promise<Grant[]> {
  return db
    .select({ code: permissions.code, branchId: userRoles.branchId })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(userRoles.userId, userId));
}

/** Fungsi murni: apakah daftar grant mengizinkan permission pada cakupan tertentu. */
export function can(
  grants: readonly Grant[],
  permission: PermissionCode,
  scope: PermissionScope = {},
): boolean {
  return grants.some((grant) => {
    if (grant.code !== permission) return false;
    if (grant.branchId === null) return true;
    if (scope.anyBranch) return true;
    return scope.branchId !== undefined && grant.branchId === scope.branchId;
  });
}

/**
 * Cabang yang boleh diakses untuk suatu permission: "all" bila ada izin global,
 * selain itu daftar id cabang (bisa kosong).
 */
export function accessibleBranchIds(
  grants: readonly Grant[],
  permission: PermissionCode,
): "all" | string[] {
  const matching = grants.filter((grant) => grant.code === permission);
  if (matching.some((grant) => grant.branchId === null)) return "all";

  const ids = new Set<string>();
  for (const grant of matching) {
    if (grant.branchId !== null) ids.add(grant.branchId);
  }
  return [...ids];
}

/** Sesi valid dan akun aktif, atau AppError 401. Status dibaca dari database pada setiap panggilan. */
export async function requireSession(): Promise<SessionActor> {
  const session = await getServerSession();

  if (!session || session.user.status !== "active") {
    throw unauthenticated();
  }

  return { userId: session.user.id, name: session.user.name, email: session.user.email };
}

/** Sesi valid + izin yang sesuai, atau AppError 401/403. */
export async function requirePermission(
  permission: PermissionCode,
  scope: PermissionScope = {},
): Promise<AuthContext> {
  const actor = await requireSession();
  const grants = await loadGrants(actor.userId);

  if (!can(grants, permission, scope)) {
    throw forbidden();
  }

  return { ...actor, grants };
}