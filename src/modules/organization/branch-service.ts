import { and, asc, eq, sql } from "drizzle-orm";

import { branches, departments, userRoles } from "@/db/schema";
import type {
  CreateBranchInput,
  ListBranchesQuery,
  UpdateBranchInput,
} from "@/modules/organization/schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { businessRule, conflict, forbidden, notFound } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "select">;

/* ------------------------------------------------------------------ */
/* Helper                                                              */
/* ------------------------------------------------------------------ */

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

const branchColumns = {
  id: branches.id,
  code: branches.code,
  name: branches.name,
  address: branches.address,
  phone: branches.phone,
  isActive: branches.isActive,
  createdAt: branches.createdAt,
  updatedAt: branches.updatedAt,
};

async function loadBranch(reader: Reader, id: string) {
  const [row] = await reader
    .select(branchColumns)
    .from(branches)
    .where(eq(branches.id, id))
    .limit(1);
  return row;
}

async function requireBranch(reader: Reader, id: string) {
  const row = await loadBranch(reader, id);
  if (!row) throw notFound("Cabang tidak ditemukan.");
  return row;
}

/** Mengunci baris cabang (FOR UPDATE) selama transaksi. */
async function lockBranch(tx: Tx, id: string) {
  const [row] = await tx
    .select(branchColumns)
    .from(branches)
    .where(eq(branches.id, id))
    .for("update");
  if (!row) throw notFound("Cabang tidak ditemukan.");
  return row;
}

async function countActiveDepartments(reader: Reader, branchId: string): Promise<number> {
  const [row] = await reader
    .select({ count: sql<number>`count(*)::int` })
    .from(departments)
    .where(and(eq(departments.branchId, branchId), eq(departments.isActive, true)));
  return row?.count ?? 0;
}

async function countBranchRoleAssignments(reader: Reader, branchId: string): Promise<number> {
  const [row] = await reader
    .select({ count: sql<number>`count(*)::int` })
    .from(userRoles)
    .where(eq(userRoles.branchId, branchId));
  return row?.count ?? 0;
}

/* ------------------------------------------------------------------ */
/* Baca                                                                */
/* ------------------------------------------------------------------ */

export async function listBranches(actor: AuthContext, query: ListBranchesQuery = {}) {
  assertCan(actor, "core.branches.read");

  return db
    .select(branchColumns)
    .from(branches)
    .where(query.isActive === undefined ? undefined : eq(branches.isActive, query.isActive))
    .orderBy(asc(branches.code));
}

export async function getBranch(actor: AuthContext, id: string) {
  assertCan(actor, "core.branches.read");
  return requireBranch(db, id);
}

/* ------------------------------------------------------------------ */
/* Tulis                                                               */
/* ------------------------------------------------------------------ */

export async function createBranch(actor: AuthContext, input: CreateBranchInput) {
  assertCan(actor, "core.branches.manage");

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: branches.id })
      .from(branches)
      .where(eq(branches.code, input.code))
      .limit(1);
    if (existing) throw conflict("Kode cabang sudah dipakai.");

    const values = {
      code: input.code,
      name: input.name,
      address: input.address ?? null,
      phone: input.phone ?? null,
    };

    const [created] = await tx
      .insert(branches)
      .values({ ...values, isActive: true, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: branches.id });
    if (!created) throw new Error("Gagal membuat cabang.");

    await audit.log(
      {
        action: "branch.create",
        entityType: "branch",
        entityId: created.id,
        actorId: actor.userId,
        after: values,
      },
      tx,
    );

    return requireBranch(tx, created.id);
  });
}

const UPDATABLE_FIELDS = ["name", "address", "phone", "isActive"] as const;

export async function updateBranch(actor: AuthContext, id: string, input: UpdateBranchInput) {
  assertCan(actor, "core.branches.manage");

  return db.transaction(async (tx) => {
    // Saat menonaktifkan, kunci SELURUH cabang aktif (urut id) lebih dulu agar aturan
    // "cabang aktif terakhir" aman dari balapan dan urutan kunci selalu sama (bebas deadlock).
    let activeCount: number | undefined;
    if (input.isActive === false) {
      const active = await tx
        .select({ id: branches.id })
        .from(branches)
        .where(eq(branches.isActive, true))
        .orderBy(asc(branches.id))
        .for("update");
      activeCount = active.length;
    }

    const branch = await lockBranch(tx, id);

    const next = {
      name: input.name ?? branch.name,
      address: input.address === undefined ? branch.address : input.address,
      phone: input.phone === undefined ? branch.phone : input.phone,
      isActive: input.isActive ?? branch.isActive,
    };

    const changedFields = UPDATABLE_FIELDS.filter((field) => next[field] !== branch[field]);
    if (changedFields.length === 0) return branch;

    const deactivating = branch.isActive && !next.isActive;
    if (deactivating) {
      if (activeCount !== undefined && activeCount <= 1) {
        throw businessRule("Cabang aktif terakhir tidak dapat dinonaktifkan.");
      }

      const activeDepartments = await countActiveDepartments(tx, id);
      if (activeDepartments > 0) {
        throw conflict(`Cabang masih memiliki ${activeDepartments} departemen aktif.`);
      }

      const roleAssignments = await countBranchRoleAssignments(tx, id);
      if (roleAssignments > 0) {
        throw conflict(
          `Cabang masih memiliki ${roleAssignments} penugasan role khusus cabang ini.`,
        );
      }
    }

    await tx
      .update(branches)
      .set({ ...next, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(branches.id, id));

    await audit.log(
      {
        action: "branch.update",
        entityType: "branch",
        entityId: id,
        actorId: actor.userId,
        before: Object.fromEntries(changedFields.map((field) => [field, branch[field]])),
        after: Object.fromEntries(changedFields.map((field) => [field, next[field]])),
      },
      tx,
    );

    return requireBranch(tx, id);
  });
}