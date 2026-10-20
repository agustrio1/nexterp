import { and, desc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";

import {
  accounts,
  branches,
  permissions,
  rolePermissions,
  roles,
  sessions,
  userRoles,
  users,
} from "@/db/schema";
import type {
  CreateUserInput,
  ReplaceUserRolesInput,
  UpdateUserInput,
} from "@/modules/users/schemas";
import { audit } from "@/server/audit";
import { hashPassword } from "@/server/auth/password";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { businessRule, conflict, forbidden, notFound, validationFailed } from "@/server/errors";
import { toLimitOffset } from "@/server/validation";

const SUPER_ADMIN_ROLE = "super_admin";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "select">;
type AssignmentLike = { roleId: string; branchId: string | null };

const userColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  status: users.status,
  lastLoginAt: users.lastLoginAt,
  lockedUntil: users.lockedUntil,
  createdAt: users.createdAt,
};

/* ------------------------------------------------------------------ */
/* Helper                                                              */
/* ------------------------------------------------------------------ */

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function assignmentKey(a: AssignmentLike): string {
  return `${a.roleId}:${a.branchId ?? ""}`;
}

async function loadAssignments(reader: Reader, userId: string) {
  return reader
    .select({
      id: userRoles.id,
      roleId: userRoles.roleId,
      roleCode: roles.code,
      roleName: roles.name,
      branchId: userRoles.branchId,
    })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId))
    .orderBy(roles.code);
}

type Assignment = Awaited<ReturnType<typeof loadAssignments>>[number];

async function loadUserDetail(reader: Reader, id: string) {
  const [user] = await reader.select(userColumns).from(users).where(eq(users.id, id)).limit(1);
  if (!user) throw notFound("Pengguna tidak ditemukan.");

  const assignments = await loadAssignments(reader, id);
  return {
    ...user,
    roles: assignments.map((a) => ({
      roleId: a.roleId,
      code: a.roleCode,
      name: a.roleName,
      branchId: a.branchId,
    })),
  };
}

/** Mengunci baris pengguna (FOR UPDATE) selama transaksi. */
async function lockTarget(tx: Tx, id: string) {
  const [row] = await tx
    .select({ id: users.id, name: users.name, email: users.email, status: users.status })
    .from(users)
    .where(eq(users.id, id))
    .for("update");
  if (!row) throw notFound("Pengguna tidak ditemukan.");
  return row;
}

/** Serialisasi operasi yang bisa mengubah jumlah Super Admin global aktif. */
async function lockSuperAdminGuard(tx: Tx): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('erp.super_admin_guard'))`);
}

function isGlobalSuperAdmin(a: { roleCode: string; branchId: string | null }): boolean {
  return a.roleCode === SUPER_ADMIN_ROLE && a.branchId === null;
}

async function assertAnotherSuperAdminRemains(tx: Tx, excludeUserId: string): Promise<void> {
  const [row] = await tx
    .select({ count: sql<number>`count(distinct ${userRoles.userId})::int` })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(
      and(
        eq(roles.code, SUPER_ADMIN_ROLE),
        isNull(userRoles.branchId),
        eq(users.status, "active"),
        ne(userRoles.userId, excludeUserId),
      ),
    );

  if ((row?.count ?? 0) === 0) {
    throw businessRule("Harus selalu ada minimal satu Super Admin global yang aktif.");
  }
}

async function assertAssignmentsExist(
  reader: Reader,
  assignments: readonly AssignmentLike[],
): Promise<void> {
  const roleIds = [...new Set(assignments.map((a) => a.roleId))];
  if (roleIds.length > 0) {
    const found = await reader.select({ id: roles.id }).from(roles).where(inArray(roles.id, roleIds));
    if (found.length !== roleIds.length) {
      throw validationFailed([{ path: "roles", message: "Ada role yang tidak ditemukan." }]);
    }
  }

  const branchIds = [...new Set(assignments.flatMap((a) => (a.branchId ? [a.branchId] : [])))];
  if (branchIds.length > 0) {
    const found = await reader
      .select({ id: branches.id })
      .from(branches)
      .where(inArray(branches.id, branchIds));
    if (found.length !== branchIds.length) {
      throw validationFailed([{ path: "roles", message: "Ada cabang yang tidak ditemukan." }]);
    }
  }
}

/**
 * Pencegahan eskalasi hak: aktor harus memiliki SEMUA permission dari setiap role pada
 * cakupan yang sama (global untuk branchId null, atau cabang tertentu).
 */
async function assertWithinActorPermissions(
  reader: Reader,
  actor: AuthContext,
  assignments: readonly AssignmentLike[],
): Promise<void> {
  if (assignments.length === 0) return;

  const roleIds = [...new Set(assignments.map((a) => a.roleId))];
  const rows = await reader
    .select({ roleId: rolePermissions.roleId, code: permissions.code })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(inArray(rolePermissions.roleId, roleIds));

  const codesByRole = new Map<string, string[]>();
  for (const row of rows) {
    const list = codesByRole.get(row.roleId) ?? [];
    list.push(row.code);
    codesByRole.set(row.roleId, list);
  }

  for (const assignment of assignments) {
    const scope = assignment.branchId === null ? {} : { branchId: assignment.branchId };
    for (const code of codesByRole.get(assignment.roleId) ?? []) {
      // Kode berasal dari database; hasil pengecekan tetap benar untuk kode yang belum ada di tipe.
      if (!can(actor.grants, code as PermissionCode, scope)) {
        throw forbidden(
          "Anda tidak dapat mengelola atau memberikan role yang memiliki izin melebihi izin Anda.",
        );
      }
    }
  }
}

/** Target hanya boleh dikelola bila seluruh role-nya masih dalam jangkauan izin aktor. */
async function assertCanManageTarget(
  tx: Tx,
  actor: AuthContext,
  targetId: string,
): Promise<Assignment[]> {
  const assignments = await loadAssignments(tx, targetId);
  await assertWithinActorPermissions(tx, actor, assignments);
  return assignments;
}

/* ------------------------------------------------------------------ */
/* Operasi                                                             */
/* ------------------------------------------------------------------ */

export type ListUsersQuery = {
  page: number;
  pageSize: number;
  search?: string | undefined;
  status?: "active" | "suspended" | undefined;
};

export async function listUsers(actor: AuthContext, query: ListUsersQuery) {
  assertCan(actor, "core.users.read");

  const filters = [];
  if (query.status) filters.push(eq(users.status, query.status));
  if (query.search) {
    const pattern = `%${escapeLike(query.search)}%`;
    filters.push(or(ilike(users.name, pattern), ilike(users.email, pattern)));
  }
  const where = filters.length > 0 ? and(...filters) : undefined;
  const { limit, offset } = toLimitOffset(query);

  const [items, [countRow]] = await Promise.all([
    db
      .select(userColumns)
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt), users.id)
      .limit(limit)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(users).where(where),
  ]);

  return { items, total: countRow?.total ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function getUser(actor: AuthContext, id: string) {
  assertCan(actor, "core.users.read");
  return loadUserDetail(db, id);
}

export async function createUser(actor: AuthContext, input: CreateUserInput) {
  assertCan(actor, "core.users.create");
  // Hash dihitung di luar transaksi (operasi CPU).
  const passwordHash = await hashPassword(input.password);

  return db.transaction(async (tx) => {
    await assertAssignmentsExist(tx, input.roles);
    await assertWithinActorPermissions(tx, actor, input.roles);

    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);
    if (existing) throw conflict("Email sudah terdaftar.");

    const [created] = await tx
      .insert(users)
      .values({ name: input.name, email: input.email, emailVerified: true })
      .returning({ id: users.id });
    if (!created) throw new Error("Gagal membuat pengguna.");

    await tx.insert(accounts).values({
      userId: created.id,
      accountId: created.id,
      providerId: "credential",
      password: passwordHash,
    });

    if (input.roles.length > 0) {
      await tx.insert(userRoles).values(
        input.roles.map((r) => ({
          userId: created.id,
          roleId: r.roleId,
          branchId: r.branchId,
          grantedBy: actor.userId,
        })),
      );
    }

    await audit.log(
      {
        action: "user.create",
        entityType: "user",
        entityId: created.id,
        actorId: actor.userId,
        after: { name: input.name, email: input.email, roles: input.roles },
      },
      tx,
    );

    return loadUserDetail(tx, created.id);
  });
}

export async function updateUser(actor: AuthContext, id: string, input: UpdateUserInput) {
  assertCan(actor, "core.users.update");

  return db.transaction(async (tx) => {
    const current = await lockTarget(tx, id);
    await assertCanManageTarget(tx, actor, id);

    const nextName = input.name ?? current.name;
    const nextEmail = input.email ?? current.email;

    if (nextEmail !== current.email) {
      const [duplicate] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, nextEmail), ne(users.id, id)))
        .limit(1);
      if (duplicate) throw conflict("Email sudah terdaftar.");
    }

    if (nextName === current.name && nextEmail === current.email) {
      return loadUserDetail(tx, id);
    }

    await tx
      .update(users)
      .set({ name: nextName, email: nextEmail, updatedAt: new Date() })
      .where(eq(users.id, id));

    await audit.log(
      {
        action: "user.update",
        entityType: "user",
        entityId: id,
        actorId: actor.userId,
        before: { name: current.name, email: current.email },
        after: { name: nextName, email: nextEmail },
      },
      tx,
    );

    return loadUserDetail(tx, id);
  });
}

export async function setUserStatus(
  actor: AuthContext,
  id: string,
  status: "active" | "suspended",
) {
  assertCan(actor, "core.users.deactivate");

  if (status === "suspended" && id === actor.userId) {
    throw businessRule("Anda tidak dapat menonaktifkan akun Anda sendiri.");
  }

  return db.transaction(async (tx) => {
    await lockSuperAdminGuard(tx);
    const current = await lockTarget(tx, id);
    const assignments = await assertCanManageTarget(tx, actor, id);

    if (current.status === status) {
      return loadUserDetail(tx, id);
    }

    if (status === "suspended" && assignments.some(isGlobalSuperAdmin)) {
      await assertAnotherSuperAdminRemains(tx, id);
    }

    if (status === "active") {
      await tx
        .update(users)
        .set({ status, failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
        .where(eq(users.id, id));
    } else {
      await tx.update(users).set({ status, updatedAt: new Date() }).where(eq(users.id, id));
      // Cabut seluruh sesi agar penonaktifan langsung berlaku.
      await tx.delete(sessions).where(eq(sessions.userId, id));
    }

    await audit.log(
      {
        action: status === "suspended" ? "user.suspend" : "user.activate",
        entityType: "user",
        entityId: id,
        actorId: actor.userId,
        before: { status: current.status },
        after: { status },
      },
      tx,
    );

    return loadUserDetail(tx, id);
  });
}

export async function replaceUserRoles(
  actor: AuthContext,
  id: string,
  input: ReplaceUserRolesInput,
) {
  assertCan(actor, "core.users.update");

  return db.transaction(async (tx) => {
    await lockSuperAdminGuard(tx);
    const target = await lockTarget(tx, id);
    const current = await assertCanManageTarget(tx, actor, id);

    const currentKeys = new Set(current.map(assignmentKey));
    const nextKeys = new Set(input.roles.map(assignmentKey));
    const toAdd = input.roles.filter((a) => !currentKeys.has(assignmentKey(a)));
    const toRemove = current.filter((a) => !nextKeys.has(assignmentKey(a)));

    if (toAdd.length === 0 && toRemove.length === 0) {
      return loadUserDetail(tx, id);
    }

    await assertAssignmentsExist(tx, toAdd);
    await assertWithinActorPermissions(tx, actor, toAdd);

    if (target.status === "active" && toRemove.some(isGlobalSuperAdmin)) {
      await assertAnotherSuperAdminRemains(tx, id);
    }

    if (toRemove.length > 0) {
      await tx.delete(userRoles).where(
        inArray(
          userRoles.id,
          toRemove.map((a) => a.id),
        ),
      );
    }
    if (toAdd.length > 0) {
      await tx.insert(userRoles).values(
        toAdd.map((a) => ({
          userId: id,
          roleId: a.roleId,
          branchId: a.branchId,
          grantedBy: actor.userId,
        })),
      );
    }

    await audit.log(
      {
        action: "user.roles.replace",
        entityType: "user",
        entityId: id,
        actorId: actor.userId,
        before: current.map((a) => ({ roleId: a.roleId, code: a.roleCode, branchId: a.branchId })),
        after: input.roles,
      },
      tx,
    );

    return loadUserDetail(tx, id);
  });
}

/** Reset password oleh admin. Password baru tidak pernah dicatat; seluruh sesi pengguna dicabut. */
export async function resetUserPassword(
  actor: AuthContext,
  id: string,
  password: string,
): Promise<void> {
  assertCan(actor, "core.users.update");
  const passwordHash = await hashPassword(password);

  await db.transaction(async (tx) => {
    await lockTarget(tx, id);
    await assertCanManageTarget(tx, actor, id);

    const updated = await tx
      .update(accounts)
      .set({ password: passwordHash, updatedAt: new Date() })
      .where(and(eq(accounts.userId, id), eq(accounts.providerId, "credential")))
      .returning({ id: accounts.id });

    if (updated.length === 0) {
      await tx.insert(accounts).values({
        userId: id,
        accountId: id,
        providerId: "credential",
        password: passwordHash,
      });
    }

    await tx
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(users.id, id));
    await tx.delete(sessions).where(eq(sessions.userId, id));

    await audit.log(
      {
        action: "user.password_reset",
        entityType: "user",
        entityId: id,
        actorId: actor.userId,
      },
      tx,
    );
  });
}