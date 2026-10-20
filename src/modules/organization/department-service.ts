import { and, asc, eq, sql } from "drizzle-orm";

import { branches, departments } from "@/db/schema";
import type {
  CreateDepartmentInput,
  ListDepartmentsQuery,
  UpdateDepartmentInput,
} from "@/modules/organization/schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { businessRule, conflict, forbidden, notFound, validationFailed } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "select">;

/** Batas pengaman penelusuran rantai induk (data wajar jauh di bawah ini). */
const MAX_HIERARCHY_DEPTH = 100;

/* ------------------------------------------------------------------ */
/* Helper                                                              */
/* ------------------------------------------------------------------ */

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

const departmentColumns = {
  id: departments.id,
  code: departments.code,
  name: departments.name,
  parentId: departments.parentId,
  branchId: departments.branchId,
  isActive: departments.isActive,
  createdAt: departments.createdAt,
  updatedAt: departments.updatedAt,
};

async function loadDepartment(reader: Reader, id: string) {
  const [row] = await reader
    .select(departmentColumns)
    .from(departments)
    .where(eq(departments.id, id))
    .limit(1);
  return row;
}

async function requireDepartment(reader: Reader, id: string) {
  const row = await loadDepartment(reader, id);
  if (!row) throw notFound("Departemen tidak ditemukan.");
  return row;
}

/** Mengunci baris departemen (FOR UPDATE) selama transaksi. */
async function lockDepartment(tx: Tx, id: string) {
  const [row] = await tx
    .select(departmentColumns)
    .from(departments)
    .where(eq(departments.id, id))
    .for("update");
  if (!row) throw notFound("Departemen tidak ditemukan.");
  return row;
}

/** Mengunci induk (FOR SHARE) agar tidak bisa dinonaktifkan atau dipindah di tengah transaksi ini. */
async function lockParentShared(tx: Tx, parentId: string) {
  const [parent] = await tx
    .select({
      id: departments.id,
      branchId: departments.branchId,
      isActive: departments.isActive,
    })
    .from(departments)
    .where(eq(departments.id, parentId))
    .for("share");

  if (!parent) {
    throw validationFailed([{ path: "parentId", message: "Departemen induk tidak ditemukan." }]);
  }
  return parent;
}

/** Cabang harus ada dan aktif. Dikunci FOR SHARE agar penonaktifan cabang menunggu transaksi ini. */
async function assertBranchUsable(tx: Tx, branchId: string): Promise<void> {
  const [branch] = await tx
    .select({ id: branches.id, isActive: branches.isActive })
    .from(branches)
    .where(eq(branches.id, branchId))
    .for("share");

  if (!branch) {
    throw validationFailed([{ path: "branchId", message: "Cabang tidak ditemukan." }]);
  }
  if (!branch.isActive) {
    throw businessRule("Cabang tidak aktif.");
  }
}

/** Induk yang terikat ke cabang mewajibkan anak berada di cabang yang sama. */
function assertBranchMatchesParent(
  parent: { branchId: string | null },
  branchId: string | null,
): void {
  if (parent.branchId !== null && parent.branchId !== branchId) {
    throw businessRule("Cabang departemen harus sama dengan cabang departemen induknya.");
  }
}

/** Menelusuri rantai induk dari calon induk baru; bertemu departemen ini berarti siklus. */
async function assertNoCycle(tx: Tx, departmentId: string, newParentId: string): Promise<void> {
  let currentId: string | null = newParentId;

  for (let depth = 0; depth < MAX_HIERARCHY_DEPTH && currentId !== null; depth++) {
    if (currentId === departmentId) {
      throw businessRule("Perubahan induk membentuk siklus pada hierarki departemen.");
    }

    const [row] = await tx
      .select({ parentId: departments.parentId })
      .from(departments)
      .where(eq(departments.id, currentId))
      .limit(1);
    currentId = row?.parentId ?? null;
  }

  if (currentId !== null) {
    throw new Error(`Hierarki departemen tidak wajar (lebih dari ${MAX_HIERARCHY_DEPTH} tingkat).`);
  }
}

async function countChildren(reader: Reader, parentId: string, activeOnly: boolean) {
  const [row] = await reader
    .select({ count: sql<number>`count(*)::int` })
    .from(departments)
    .where(
      activeOnly
        ? and(eq(departments.parentId, parentId), eq(departments.isActive, true))
        : eq(departments.parentId, parentId),
    );
  return row?.count ?? 0;
}

/* ------------------------------------------------------------------ */
/* Baca                                                                */
/* ------------------------------------------------------------------ */

/** Daftar datar (induk ditunjuk lewat parentId); pohon disusun oleh pemanggil. */
export async function listDepartments(actor: AuthContext, query: ListDepartmentsQuery = {}) {
  assertCan(actor, "core.departments.read");

  const conditions = [
    query.isActive === undefined ? undefined : eq(departments.isActive, query.isActive),
    query.branchId === undefined ? undefined : eq(departments.branchId, query.branchId),
  ];

  return db
    .select(departmentColumns)
    .from(departments)
    .where(and(...conditions))
    .orderBy(asc(departments.code));
}

export async function getDepartment(actor: AuthContext, id: string) {
  assertCan(actor, "core.departments.read");
  return requireDepartment(db, id);
}

/* ------------------------------------------------------------------ */
/* Tulis                                                               */
/* ------------------------------------------------------------------ */

export async function createDepartment(actor: AuthContext, input: CreateDepartmentInput) {
  assertCan(actor, "core.departments.manage");

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.code, input.code))
      .limit(1);
    if (existing) throw conflict("Kode departemen sudah dipakai.");

    const branchId = input.branchId ?? null;
    const parentId = input.parentId ?? null;

    if (branchId !== null) {
      await assertBranchUsable(tx, branchId);
    }
    if (parentId !== null) {
      const parent = await lockParentShared(tx, parentId);
      if (!parent.isActive) throw businessRule("Departemen induk tidak aktif.");
      assertBranchMatchesParent(parent, branchId);
    }

    const values = { code: input.code, name: input.name, parentId, branchId };

    const [created] = await tx
      .insert(departments)
      .values({ ...values, isActive: true, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: departments.id });
    if (!created) throw new Error("Gagal membuat departemen.");

    await audit.log(
      {
        action: "department.create",
        entityType: "department",
        entityId: created.id,
        actorId: actor.userId,
        after: values,
      },
      tx,
    );

    return requireDepartment(tx, created.id);
  });
}

const UPDATABLE_FIELDS = ["name", "parentId", "branchId", "isActive"] as const;

export async function updateDepartment(
  actor: AuthContext,
  id: string,
  input: UpdateDepartmentInput,
) {
  assertCan(actor, "core.departments.manage");

  return db.transaction(async (tx) => {
    // Perubahan yang menyentuh hierarki diserialkan agar dua pemindahan bersamaan
    // tidak bisa membentuk siklus dan urutan penguncian baris tetap konsisten.
    const touchesHierarchy =
      input.parentId !== undefined || input.branchId !== undefined || input.isActive !== undefined;
    if (touchesHierarchy) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('erp.departments.hierarchy'))`);
    }

    const department = await lockDepartment(tx, id);

    const next = {
      name: input.name ?? department.name,
      parentId: input.parentId === undefined ? department.parentId : input.parentId,
      branchId: input.branchId === undefined ? department.branchId : input.branchId,
      isActive: input.isActive ?? department.isActive,
    };

    const changedFields = UPDATABLE_FIELDS.filter((field) => next[field] !== department[field]);
    if (changedFields.length === 0) return department;

    if (next.parentId === id) {
      throw businessRule("Departemen tidak dapat menjadi induk bagi dirinya sendiri.");
    }

    const parentChanged = next.parentId !== department.parentId;
    const branchChanged = next.branchId !== department.branchId;
    const deactivating = department.isActive && !next.isActive;
    const activating = !department.isActive && next.isActive;

    if (parentChanged || branchChanged || activating) {
      if (next.branchId !== null && (branchChanged || activating)) {
        await assertBranchUsable(tx, next.branchId);
      }

      if (next.parentId !== null) {
        const parent = await lockParentShared(tx, next.parentId);
        if ((parentChanged || activating) && !parent.isActive) {
          throw businessRule("Departemen induk tidak aktif.");
        }
        if (parentChanged) {
          await assertNoCycle(tx, id, next.parentId);
        }
        assertBranchMatchesParent(parent, next.branchId);
      }
    }

    if (branchChanged && (await countChildren(tx, id, false)) > 0) {
      throw conflict("Cabang tidak dapat diubah selama departemen masih memiliki sub-departemen.");
    }

    if (deactivating) {
      const activeChildren = await countChildren(tx, id, true);
      if (activeChildren > 0) {
        throw conflict(`Departemen masih memiliki ${activeChildren} sub-departemen aktif.`);
      }
    }

    await tx
      .update(departments)
      .set({ ...next, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(departments.id, id));

    await audit.log(
      {
        action: "department.update",
        entityType: "department",
        entityId: id,
        actorId: actor.userId,
        before: Object.fromEntries(changedFields.map((field) => [field, department[field]])),
        after: Object.fromEntries(changedFields.map((field) => [field, next[field]])),
      },
      tx,
    );

    return requireDepartment(tx, id);
  });
}