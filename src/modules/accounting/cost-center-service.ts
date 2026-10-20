import { and, asc, eq, sql } from "drizzle-orm";

import { branches, costCenters, journalEntryLines } from "@/db/schema";
import type {
  CreateCostCenterInput,
  ListCostCentersQuery,
  UpdateCostCenterInput,
} from "@/modules/accounting/tax-cost-schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { businessRule, conflict, forbidden, notFound, validationFailed } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "select">;

const MAX_HIERARCHY_DEPTH = 100;

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

/** Menjalankan `fn` dalam transaksi baru atau memakai `tx` eksternal bila diberikan. */
async function inTx<T>(externalTx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (externalTx) return fn(externalTx);
  return db.transaction(fn);
}

const costCenterColumns = {
  id: costCenters.id,
  code: costCenters.code,
  name: costCenters.name,
  parentId: costCenters.parentId,
  branchId: costCenters.branchId,
  isActive: costCenters.isActive,
  description: costCenters.description,
  createdAt: costCenters.createdAt,
  updatedAt: costCenters.updatedAt,
};

async function loadCostCenter(reader: Reader, id: string) {
  const [row] = await reader
    .select(costCenterColumns)
    .from(costCenters)
    .where(eq(costCenters.id, id))
    .limit(1);
  return row;
}

async function requireCostCenter(reader: Reader, id: string) {
  const row = await loadCostCenter(reader, id);
  if (!row) throw notFound("Pusat biaya tidak ditemukan.");
  return row;
}

async function lockCostCenter(tx: Tx, id: string) {
  const [row] = await tx
    .select(costCenterColumns)
    .from(costCenters)
    .where(eq(costCenters.id, id))
    .for("update")
    .limit(1);
  if (!row) throw notFound("Pusat biaya tidak ditemukan.");
  return row;
}

async function lockParentShared(tx: Tx, parentId: string) {
  const [parent] = await tx
    .select({ id: costCenters.id, branchId: costCenters.branchId, isActive: costCenters.isActive })
    .from(costCenters)
    .where(eq(costCenters.id, parentId))
    .for("share")
    .limit(1);
  if (!parent) {
    throw validationFailed([{ path: "parentId", message: "Pusat biaya induk tidak ditemukan." }]);
  }
  return parent;
}

async function assertBranchUsable(tx: Tx, branchId: string): Promise<void> {
  const [branch] = await tx
    .select({ id: branches.id, isActive: branches.isActive })
    .from(branches)
    .where(eq(branches.id, branchId))
    .for("share")
    .limit(1);
  if (!branch) throw validationFailed([{ path: "branchId", message: "Cabang tidak ditemukan." }]);
  if (!branch.isActive) throw businessRule("Cabang tidak aktif.");
}

function assertBranchMatchesParent(parent: { branchId: string | null }, branchId: string | null) {
  if (parent.branchId !== null && parent.branchId !== branchId) {
    throw businessRule("Cabang pusat biaya harus sama dengan cabang induknya.");
  }
}

async function assertNoCycle(tx: Tx, costCenterId: string, newParentId: string): Promise<void> {
  let currentId: string | null = newParentId;
  for (let depth = 0; depth < MAX_HIERARCHY_DEPTH && currentId !== null; depth++) {
    if (currentId === costCenterId) {
      throw businessRule("Perubahan induk membentuk siklus pada hierarki pusat biaya.");
    }
    const [row] = await tx
      .select({ parentId: costCenters.parentId })
      .from(costCenters)
      .where(eq(costCenters.id, currentId))
      .limit(1);
    currentId = row?.parentId ?? null;
  }
  if (currentId !== null) {
    throw new Error(`Hierarki pusat biaya tidak wajar (lebih dari ${MAX_HIERARCHY_DEPTH} tingkat).`);
  }
}

async function countChildren(reader: Reader, parentId: string, activeOnly: boolean) {
  const [row] = await reader
    .select({ count: sql<number>`count(*)::int` })
    .from(costCenters)
    .where(
      activeOnly
        ? and(eq(costCenters.parentId, parentId), eq(costCenters.isActive, true))
        : eq(costCenters.parentId, parentId),
    );
  return row?.count ?? 0;
}

/** Jumlah baris jurnal yang memakai pusat biaya ini (penanda pemakaian). */
async function countJournalUsage(reader: Reader, costCenterId: string) {
  const [row] = await reader
    .select({ count: sql<number>`count(*)::int` })
    .from(journalEntryLines)
    .where(eq(journalEntryLines.costCenterId, costCenterId));
  return row?.count ?? 0;
}

/* ------------------------------------------------------------------ */
/* Baca                                                                */
/* ------------------------------------------------------------------ */

export async function listCostCenters(
  actor: AuthContext,
  query: ListCostCentersQuery = {},
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.cost_centers.read");

  const reader: Reader = externalTx ?? db;
  const conditions = [
    query.isActive === undefined ? undefined : eq(costCenters.isActive, query.isActive),
    query.branchId === undefined ? undefined : eq(costCenters.branchId, query.branchId),
  ];

  return reader
    .select(costCenterColumns)
    .from(costCenters)
    .where(and(...conditions))
    .orderBy(asc(costCenters.code));
}

export async function getCostCenter(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "accounting.cost_centers.read");
  return requireCostCenter(externalTx ?? db, id);
}

/* ------------------------------------------------------------------ */
/* Tulis                                                               */
/* ------------------------------------------------------------------ */

export async function createCostCenter(
  actor: AuthContext,
  input: CreateCostCenterInput,
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.cost_centers.manage");

  return inTx(externalTx, async (tx) => {
    const [existing] = await tx
      .select({ id: costCenters.id })
      .from(costCenters)
      .where(eq(costCenters.code, input.code))
      .limit(1);
    if (existing) throw conflict("Kode pusat biaya sudah dipakai.");

    const branchId = input.branchId ?? null;
    const parentId = input.parentId ?? null;

    if (branchId !== null) await assertBranchUsable(tx, branchId);
    if (parentId !== null) {
      const parent = await lockParentShared(tx, parentId);
      if (!parent.isActive) throw businessRule("Pusat biaya induk tidak aktif.");
      assertBranchMatchesParent(parent, branchId);
    }

    const values = {
      code: input.code,
      name: input.name,
      parentId,
      branchId,
      description: input.description ?? null,
    };

    const [created] = await tx
      .insert(costCenters)
      .values({ ...values, isActive: true, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: costCenters.id });
    if (!created) throw new Error("Gagal membuat pusat biaya.");

    await audit.log(
      {
        action: "cost_center.create",
        entityType: "cost_center",
        entityId: created.id,
        actorId: actor.userId,
        after: values,
      },
      tx,
    );

    return requireCostCenter(tx, created.id);
  });
}

const UPDATABLE_FIELDS = ["name", "parentId", "branchId", "isActive", "description"] as const;

export async function updateCostCenter(
  actor: AuthContext,
  id: string,
  input: UpdateCostCenterInput,
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.cost_centers.manage");

  return inTx(externalTx, async (tx) => {
    const touchesHierarchy =
      input.parentId !== undefined || input.branchId !== undefined || input.isActive !== undefined;
    if (touchesHierarchy) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('erp.cost_centers.hierarchy'))`);
    }

    const costCenter = await lockCostCenter(tx, id);

    const next = {
      name: input.name ?? costCenter.name,
      parentId: input.parentId === undefined ? costCenter.parentId : input.parentId,
      branchId: input.branchId === undefined ? costCenter.branchId : input.branchId,
      isActive: input.isActive ?? costCenter.isActive,
      description: input.description === undefined ? costCenter.description : input.description,
    };

    const changedFields = UPDATABLE_FIELDS.filter((field) => next[field] !== costCenter[field]);
    if (changedFields.length === 0) return costCenter;

    if (next.parentId === id) {
      throw businessRule("Pusat biaya tidak dapat menjadi induk bagi dirinya sendiri.");
    }

    const parentChanged = next.parentId !== costCenter.parentId;
    const branchChanged = next.branchId !== costCenter.branchId;
    const deactivating = costCenter.isActive && !next.isActive;
    const activating = !costCenter.isActive && next.isActive;

    if (parentChanged || branchChanged || activating) {
      if (next.branchId !== null && (branchChanged || activating)) {
        await assertBranchUsable(tx, next.branchId);
      }
      if (next.parentId !== null) {
        const parent = await lockParentShared(tx, next.parentId);
        if ((parentChanged || activating) && !parent.isActive) {
          throw businessRule("Pusat biaya induk tidak aktif.");
        }
        if (parentChanged) await assertNoCycle(tx, id, next.parentId);
        assertBranchMatchesParent(parent, next.branchId);
      }
    }

    if (branchChanged && (await countChildren(tx, id, false)) > 0) {
      throw conflict("Cabang tidak dapat diubah selama pusat biaya masih memiliki anak.");
    }

    if (deactivating) {
      const activeChildren = await countChildren(tx, id, true);
      if (activeChildren > 0) {
        throw conflict(`Pusat biaya masih memiliki ${activeChildren} anak aktif.`);
      }
      const used = await countJournalUsage(tx, id);
      if (used > 0) {
        throw conflict(`Pusat biaya masih dipakai ${used} baris jurnal.`);
      }
    }

    await tx
      .update(costCenters)
      .set({ ...next, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(costCenters.id, id));

    await audit.log(
      {
        action: "cost_center.update",
        entityType: "cost_center",
        entityId: id,
        actorId: actor.userId,
        before: Object.fromEntries(changedFields.map((field) => [field, costCenter[field]])),
        after: Object.fromEntries(changedFields.map((field) => [field, next[field]])),
      },
      tx,
    );

    return requireCostCenter(tx, id);
  });
}
