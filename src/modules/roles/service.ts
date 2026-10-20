import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { permissions, rolePermissions, roles, userRoles } from "@/db/schema";
import type { CreateRoleInput, UpdateRoleInput } from "@/modules/roles/schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { businessRule, conflict, forbidden, notFound, validationFailed } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "select">;

/* ------------------------------------------------------------------ */
/* Helper                                                              */
/* ------------------------------------------------------------------ */

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

/**
 * Pencegahan eskalasi hak: aktor harus memegang SEMUA permission secara global
 * (role bisa ditugaskan tanpa batasan cabang).
 */
function assertActorHoldsAll(actor: AuthContext, codes: readonly string[]): void {
  for (const code of codes) {
    // Kode berasal dari input/database; hasil pengecekan tetap benar untuk kode yang belum ada di tipe.
    if (!can(actor.grants, code as PermissionCode)) {
      throw forbidden(
        "Anda tidak dapat mengelola role yang memuat izin melebihi izin Anda sendiri.",
      );
    }
  }
}

function normalizeDescription(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value === null || value === "" ? null : value;
}

async function loadRolePermissions(reader: Reader, roleId: string) {
  return reader
    .select({ id: permissions.id, code: permissions.code })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(rolePermissions.roleId, roleId))
    .orderBy(asc(permissions.code));
}

async function loadRoleDetail(reader: Reader, id: string) {
  const [role] = await reader
    .select({
      id: roles.id,
      code: roles.code,
      name: roles.name,
      description: roles.description,
      isSystem: roles.isSystem,
      createdAt: roles.createdAt,
    })
    .from(roles)
    .where(eq(roles.id, id))
    .limit(1);
  if (!role) throw notFound("Role tidak ditemukan.");

  const perms = await loadRolePermissions(reader, id);
  return { ...role, permissionCodes: perms.map((p) => p.code) };
}

/** Mengunci baris role (FOR UPDATE) selama transaksi. */
async function lockRole(tx: Tx, id: string) {
  const [role] = await tx
    .select({
      id: roles.id,
      code: roles.code,
      name: roles.name,
      description: roles.description,
      isSystem: roles.isSystem,
    })
    .from(roles)
    .where(eq(roles.id, id))
    .for("update");
  if (!role) throw notFound("Role tidak ditemukan.");
  return role;
}

function assertNotSystem(role: { isSystem: boolean }): void {
  if (role.isSystem) throw businessRule("Role bawaan sistem tidak dapat diubah atau dihapus.");
}

async function resolvePermissions(reader: Reader, codes: readonly string[]) {
  if (codes.length === 0) return [];

  const rows = await reader
    .select({ id: permissions.id, code: permissions.code })
    .from(permissions)
    .where(inArray(permissions.code, [...codes]));

  const known = new Set(rows.map((r) => r.code));
  const unknown = codes.filter((code) => !known.has(code));
  if (unknown.length > 0) {
    throw validationFailed([
      { path: "permissionCodes", message: `Permission tidak dikenal: ${unknown.join(", ")}.` },
    ]);
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* Baca                                                                */
/* ------------------------------------------------------------------ */

export async function listRoles(actor: AuthContext) {
  assertCan(actor, "core.roles.read");

  return db
    .select({
      id: roles.id,
      code: roles.code,
      name: roles.name,
      description: roles.description,
      isSystem: roles.isSystem,
      permissionCount: sql<number>`count(distinct ${rolePermissions.permissionId})::int`,
      userCount: sql<number>`count(distinct ${userRoles.userId})::int`,
    })
    .from(roles)
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .leftJoin(userRoles, eq(userRoles.roleId, roles.id))
    .groupBy(roles.id)
    .orderBy(asc(roles.code));
}

export async function getRole(actor: AuthContext, id: string) {
  assertCan(actor, "core.roles.read");
  return loadRoleDetail(db, id);
}

/** Seluruh permission, dikelompokkan per modul, untuk dipilih saat membuat atau mengubah role. */
export async function listPermissions(actor: AuthContext) {
  assertCan(actor, "core.permissions.read");

  const rows = await db
    .select({
      code: permissions.code,
      module: permissions.module,
      description: permissions.description,
    })
    .from(permissions)
    .orderBy(asc(permissions.module), asc(permissions.code));

  const byModule = new Map<string, { code: string; description: string | null }[]>();
  for (const row of rows) {
    const list = byModule.get(row.module) ?? [];
    list.push({ code: row.code, description: row.description });
    byModule.set(row.module, list);
  }

  return [...byModule.entries()].map(([module, perms]) => ({ module, permissions: perms }));
}

/* ------------------------------------------------------------------ */
/* Tulis                                                               */
/* ------------------------------------------------------------------ */

export async function createRole(actor: AuthContext, input: CreateRoleInput) {
  assertCan(actor, "core.roles.manage");

  return db.transaction(async (tx) => {
    const resolved = await resolvePermissions(tx, input.permissionCodes);
    assertActorHoldsAll(actor, input.permissionCodes);

    const [existing] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.code, input.code))
      .limit(1);
    if (existing) throw conflict("Kode role sudah dipakai.");

    const description = normalizeDescription(input.description) ?? null;
    const [created] = await tx
      .insert(roles)
      .values({ code: input.code, name: input.name, description, isSystem: false })
      .returning({ id: roles.id });
    if (!created) throw new Error("Gagal membuat role.");

    if (resolved.length > 0) {
      await tx
        .insert(rolePermissions)
        .values(resolved.map((p) => ({ roleId: created.id, permissionId: p.id })));
    }

    await audit.log(
      {
        action: "role.create",
        entityType: "role",
        entityId: created.id,
        actorId: actor.userId,
        after: {
          code: input.code,
          name: input.name,
          description,
          permissionCodes: [...input.permissionCodes].sort(),
        },
      },
      tx,
    );

    return loadRoleDetail(tx, created.id);
  });
}

export async function updateRole(actor: AuthContext, id: string, input: UpdateRoleInput) {
  assertCan(actor, "core.roles.manage");

  return db.transaction(async (tx) => {
    const role = await lockRole(tx, id);
    assertNotSystem(role);

    const current = await loadRolePermissions(tx, id);
    // Role yang sudah ada hanya boleh dikelola bila seluruh izinnya dalam jangkauan aktor.
    assertActorHoldsAll(
      actor,
      current.map((p) => p.code),
    );

    const nameChanged = input.name !== undefined && input.name !== role.name;
    const nextDescription = normalizeDescription(input.description);
    const descriptionChanged =
      nextDescription !== undefined && nextDescription !== role.description;

    let toAdd: { id: string; code: string }[] = [];
    let toRemove: { id: string; code: string }[] = [];
    if (input.permissionCodes !== undefined) {
      const resolved = await resolvePermissions(tx, input.permissionCodes);
      assertActorHoldsAll(actor, input.permissionCodes);

      const currentCodes = new Set(current.map((p) => p.code));
      const nextCodes = new Set(input.permissionCodes);
      toAdd = resolved.filter((p) => !currentCodes.has(p.code));
      toRemove = current.filter((p) => !nextCodes.has(p.code));
    }

    if (!nameChanged && !descriptionChanged && toAdd.length === 0 && toRemove.length === 0) {
      return loadRoleDetail(tx, id);
    }

    if (nameChanged || descriptionChanged) {
      await tx
        .update(roles)
        .set({
          ...(nameChanged && input.name !== undefined ? { name: input.name } : {}),
          ...(descriptionChanged ? { description: nextDescription ?? null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(roles.id, id));
    }

    if (toRemove.length > 0) {
      await tx.delete(rolePermissions).where(
        and(
          eq(rolePermissions.roleId, id),
          inArray(
            rolePermissions.permissionId,
            toRemove.map((p) => p.id),
          ),
        ),
      );
    }
    if (toAdd.length > 0) {
      await tx
        .insert(rolePermissions)
        .values(toAdd.map((p) => ({ roleId: id, permissionId: p.id })));
    }

    const removedCodes = new Set(toRemove.map((p) => p.code));
    const nextPermissionCodes = [
      ...current.map((p) => p.code).filter((code) => !removedCodes.has(code)),
      ...toAdd.map((p) => p.code),
    ].sort();

    await audit.log(
      {
        action: "role.update",
        entityType: "role",
        entityId: id,
        actorId: actor.userId,
        before: {
          name: role.name,
          description: role.description,
          permissionCodes: current.map((p) => p.code),
        },
        after: {
          name: nameChanged && input.name !== undefined ? input.name : role.name,
          description: descriptionChanged ? (nextDescription ?? null) : role.description,
          permissionCodes: nextPermissionCodes,
        },
      },
      tx,
    );

    return loadRoleDetail(tx, id);
  });
}

export async function deleteRole(actor: AuthContext, id: string): Promise<void> {
  assertCan(actor, "core.roles.manage");

  await db.transaction(async (tx) => {
    const role = await lockRole(tx, id);
    assertNotSystem(role);

    const current = await loadRolePermissions(tx, id);
    assertActorHoldsAll(
      actor,
      current.map((p) => p.code),
    );

    const [usage] = await tx
      .select({ count: sql<number>`count(distinct ${userRoles.userId})::int` })
      .from(userRoles)
      .where(eq(userRoles.roleId, id));
    const assignedUsers = usage?.count ?? 0;
    if (assignedUsers > 0) {
      throw conflict(`Role masih ditugaskan ke ${assignedUsers} pengguna.`);
    }

    // role_permissions ikut terhapus lewat ON DELETE CASCADE.
    await tx.delete(roles).where(eq(roles.id, id));

    await audit.log(
      {
        action: "role.delete",
        entityType: "role",
        entityId: id,
        actorId: actor.userId,
        before: {
          code: role.code,
          name: role.name,
          description: role.description,
          permissionCodes: current.map((p) => p.code),
        },
      },
      tx,
    );
  });
}