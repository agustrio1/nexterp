import { and, asc, eq, inArray, sql } from "drizzle-orm";

import {
  accountingPeriods,
  budgetLines,
  budgets,
  branches,
  chartAccounts,
  costCenters,
  fiscalYears,
} from "@/db/schema";
import { toDb } from "@/lib/money";
import type {
  BudgetLineInput,
  CreateBudgetInput,
  ListBudgetsQuery,
  ReplaceBudgetLinesInput,
  UpdateBudgetInput,
} from "@/modules/accounting/budget-schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { businessRule, conflict, forbidden, notFound, validationFailed } from "@/server/errors";
import { nextDocumentNumber } from "@/server/numbering";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "select">;

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

async function inTx<T>(externalTx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (externalTx) return fn(externalTx);
  return db.transaction(fn);
}

const budgetColumns = {
  id: budgets.id,
  docNo: budgets.docNo,
  name: budgets.name,
  fiscalYearId: budgets.fiscalYearId,
  fiscalYearCode: fiscalYears.code,
  branchId: budgets.branchId,
  branchName: branches.name,
  status: budgets.status,
  notes: budgets.notes,
  approvedAt: budgets.approvedAt,
  approvedBy: budgets.approvedBy,
  createdAt: budgets.createdAt,
  updatedAt: budgets.updatedAt,
};

const lineColumns = {
  id: budgetLines.id,
  budgetId: budgetLines.budgetId,
  accountId: budgetLines.accountId,
  accountCode: chartAccounts.code,
  accountName: chartAccounts.name,
  accountType: chartAccounts.type,
  periodId: budgetLines.periodId,
  periodNo: accountingPeriods.periodNo,
  costCenterId: budgetLines.costCenterId,
  costCenterCode: costCenters.code,
  amount: budgetLines.amount,
  note: budgetLines.note,
};

async function requireBudget(reader: Reader, id: string) {
  const [row] = await reader
    .select(budgetColumns)
    .from(budgets)
    .innerJoin(fiscalYears, eq(fiscalYears.id, budgets.fiscalYearId))
    .leftJoin(branches, eq(branches.id, budgets.branchId))
    .where(eq(budgets.id, id))
    .limit(1);
  if (!row) throw notFound("Anggaran tidak ditemukan.");
  return row;
}

async function lockBudget(tx: Tx, id: string) {
  const [row] = await tx
    .select({
      id: budgets.id,
      name: budgets.name,
      status: budgets.status,
      fiscalYearId: budgets.fiscalYearId,
      branchId: budgets.branchId,
      notes: budgets.notes,
    })
    .from(budgets)
    .where(eq(budgets.id, id))
    .for("update")
    .limit(1);
  if (!row) throw notFound("Anggaran tidak ditemukan.");
  return row;
}

async function listLines(reader: Reader, budgetId: string) {
  return reader
    .select(lineColumns)
    .from(budgetLines)
    .innerJoin(chartAccounts, eq(chartAccounts.id, budgetLines.accountId))
    .innerJoin(accountingPeriods, eq(accountingPeriods.id, budgetLines.periodId))
    .leftJoin(costCenters, eq(costCenters.id, budgetLines.costCenterId))
    .where(eq(budgetLines.budgetId, budgetId))
    .orderBy(asc(accountingPeriods.periodNo), asc(chartAccounts.code));
}

async function assertBranchActive(tx: Tx, branchId: string): Promise<void> {
  const [branch] = await tx
    .select({ id: branches.id, isActive: branches.isActive })
    .from(branches)
    .where(eq(branches.id, branchId))
    .limit(1);
  if (!branch) throw validationFailed([{ path: "branchId", message: "Cabang tidak ditemukan." }]);
  if (!branch.isActive) throw businessRule("Cabang tidak aktif.");
}

/**
 * Memvalidasi seluruh baris: duplikat (akun+periode+pusat biaya), akun daun postable,
 * periode milik FY anggaran, dan pusat biaya aktif. Memuat id akun & periode yang
 * dipakai agar tidak ada query per baris untuk pemeriksaan keberadaan.
 */
async function validateLines(
  tx: Tx,
  fiscalYearId: string,
  lines: readonly BudgetLineInput[],
): Promise<void> {
  const seen = new Set<string>();
  for (const line of lines) {
    const key = `${line.accountId}|${line.periodId}|${line.costCenterId ?? ""}`;
    if (seen.has(key)) {
      throw conflict("Baris anggaran ganda: kombinasi akun, periode, dan pusat biaya harus unik.");
    }
    seen.add(key);
  }

  const accountIds = [...new Set(lines.map((line) => line.accountId))];
  const periodIds = [...new Set(lines.map((line) => line.periodId))];
  const ccIds = [...new Set(lines.map((line) => line.costCenterId).filter((v): v is string => !!v))];

  const accounts = await tx
    .select({ id: chartAccounts.id, code: chartAccounts.code, isActive: chartAccounts.isActive, isPostable: chartAccounts.isPostable })
    .from(chartAccounts)
    .where(inArray(chartAccounts.id, accountIds));
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  for (const id of accountIds) {
    const account = accountMap.get(id);
    if (!account) throw validationFailed([{ path: "lines.accountId", message: "Akun GL tidak ditemukan." }]);
    if (!account.isActive) throw businessRule(`Akun GL ${account.code} tidak aktif.`);
    if (!account.isPostable) throw businessRule(`Akun GL ${account.code} bukan akun postable (induk pohon).`);
  }

  const periods = await tx
    .select({ id: accountingPeriods.id, fiscalYearId: accountingPeriods.fiscalYearId })
    .from(accountingPeriods)
    .where(inArray(accountingPeriods.id, periodIds));
  const periodMap = new Map(periods.map((p) => [p.id, p]));
  for (const id of periodIds) {
    const period = periodMap.get(id);
    if (!period) throw validationFailed([{ path: "lines.periodId", message: "Periode tidak ditemukan." }]);
    if (period.fiscalYearId !== fiscalYearId) {
      throw businessRule("Periode baris anggaran harus milik tahun fiskal anggaran.");
    }
  }

  if (ccIds.length > 0) {
    const ccs = await tx
      .select({ id: costCenters.id, code: costCenters.code, isActive: costCenters.isActive })
      .from(costCenters)
      .where(inArray(costCenters.id, ccIds));
    const ccMap = new Map(ccs.map((c) => [c.id, c]));
    for (const id of ccIds) {
      const cc = ccMap.get(id);
      if (!cc) throw validationFailed([{ path: "lines.costCenterId", message: "Pusat biaya tidak ditemukan." }]);
      if (!cc.isActive) throw businessRule(`Pusat biaya ${cc.code} tidak aktif.`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Baca                                                                */
/* ------------------------------------------------------------------ */

export async function listBudgets(actor: AuthContext, query: ListBudgetsQuery = {}, externalTx?: Tx) {
  assertCan(actor, "accounting.budgets.read");

  const reader: Reader = externalTx ?? db;
  const conditions = [
    query.fiscalYearId === undefined ? undefined : eq(budgets.fiscalYearId, query.fiscalYearId),
    query.branchId === undefined ? undefined : eq(budgets.branchId, query.branchId),
    query.status === undefined ? undefined : eq(budgets.status, query.status),
  ];

  return reader
    .select(budgetColumns)
    .from(budgets)
    .innerJoin(fiscalYears, eq(fiscalYears.id, budgets.fiscalYearId))
    .leftJoin(branches, eq(branches.id, budgets.branchId))
    .where(and(...conditions))
    .orderBy(asc(budgets.name));
}

export async function getBudget(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "accounting.budgets.read");
  const reader: Reader = externalTx ?? db;
  const header = await requireBudget(reader, id);
  const lines = await listLines(reader, id);
  return { ...header, lines };
}

/* ------------------------------------------------------------------ */
/* Tulis                                                               */
/* ------------------------------------------------------------------ */

export async function createBudget(actor: AuthContext, input: CreateBudgetInput, externalTx?: Tx) {
  assertCan(actor, "accounting.budgets.manage");

  return inTx(externalTx, async (tx) => {
    const [fy] = await tx
      .select({ id: fiscalYears.id, startDate: fiscalYears.startDate, endDate: fiscalYears.endDate })
      .from(fiscalYears)
      .where(eq(fiscalYears.id, input.fiscalYearId))
      .limit(1);
    if (!fy) throw validationFailed([{ path: "fiscalYearId", message: "Tahun fiskal tidak ditemukan." }]);

    const branchId = input.branchId ?? null;
    if (branchId !== null) await assertBranchActive(tx, branchId);

    await validateLines(tx, fy.id, input.lines);

    const [created] = await tx
      .insert(budgets)
      .values({
        name: input.name,
        fiscalYearId: fy.id,
        branchId,
        notes: input.notes ?? null,
        status: "draft",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: budgets.id });
    if (!created) throw new Error("Gagal membuat anggaran.");

    await tx.insert(budgetLines).values(
      input.lines.map((line) => ({
        budgetId: created.id,
        accountId: line.accountId,
        periodId: line.periodId,
        costCenterId: line.costCenterId ?? null,
        amount: toDb(line.amount),
        note: line.note ?? null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })),
    );

    await audit.log(
      {
        action: "budget.create",
        entityType: "budget",
        entityId: created.id,
        actorId: actor.userId,
        after: { name: input.name, fiscalYearId: fy.id, branchId, lineCount: input.lines.length },
      },
      tx,
    );

    const header = await requireBudget(tx, created.id);
    const lines = await listLines(tx, created.id);
    return { ...header, lines };
  });
}

export async function updateBudget(
  actor: AuthContext,
  id: string,
  input: UpdateBudgetInput,
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.budgets.manage");

  return inTx(externalTx, async (tx) => {
    const current = await lockBudget(tx, id);
    if (current.status !== "draft") {
      throw businessRule("Anggaran yang sudah disetujui tidak dapat diubah.");
    }

    const next = {
      name: input.name ?? current.name,
      branchId: input.branchId === undefined ? current.branchId : input.branchId,
      notes: input.notes === undefined ? current.notes : input.notes,
    };

    if (next.branchId !== null && next.branchId !== current.branchId) {
      await assertBranchActive(tx, next.branchId);
    }

    await tx
      .update(budgets)
      .set({ ...next, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(budgets.id, id));

    await audit.log(
      {
        action: "budget.update",
        entityType: "budget",
        entityId: id,
        actorId: actor.userId,
        after: next,
      },
      tx,
    );

    return requireBudget(tx, id);
  });
}

export async function replaceBudgetLines(
  actor: AuthContext,
  id: string,
  input: ReplaceBudgetLinesInput,
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.budgets.manage");

  return inTx(externalTx, async (tx) => {
    const current = await lockBudget(tx, id);
    if (current.status !== "draft") {
      throw businessRule("Baris anggaran yang sudah disetujui tidak dapat diubah.");
    }

    await validateLines(tx, current.fiscalYearId, input.lines);

    await tx.delete(budgetLines).where(eq(budgetLines.budgetId, id));
    await tx.insert(budgetLines).values(
      input.lines.map((line) => ({
        budgetId: id,
        accountId: line.accountId,
        periodId: line.periodId,
        costCenterId: line.costCenterId ?? null,
        amount: toDb(line.amount),
        note: line.note ?? null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })),
    );

    await audit.log(
      {
        action: "budget.lines_replace",
        entityType: "budget",
        entityId: id,
        actorId: actor.userId,
        after: { lineCount: input.lines.length },
      },
      tx,
    );

    const header = await requireBudget(tx, id);
    const lines = await listLines(tx, id);
    return { ...header, lines };
  });
}

export async function approveBudget(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "accounting.budgets.manage");

  return inTx(externalTx, async (tx) => {
    const current = await lockBudget(tx, id);
    if (current.status !== "draft") {
      throw businessRule("Hanya anggaran berstatus draft yang dapat disetujui.");
    }

    const [lineCountRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(budgetLines)
      .where(eq(budgetLines.budgetId, id));
    if ((lineCountRow?.count ?? 0) === 0) {
      throw businessRule("Anggaran tanpa baris tidak dapat disetujui.");
    }

    const [fy] = await tx
      .select({ startDate: fiscalYears.startDate })
      .from(fiscalYears)
      .where(eq(fiscalYears.id, current.fiscalYearId))
      .limit(1);
    if (!fy) throw businessRule("Tahun fiskal anggaran tidak ditemukan.");

    const docNo = await nextDocumentNumber(tx, "budget", { date: fy.startDate });
    const now = new Date();

    await tx
      .update(budgets)
      .set({
        status: "approved",
        docNo,
        approvedAt: now,
        approvedBy: actor.userId,
        updatedBy: actor.userId,
        updatedAt: now,
      })
      .where(eq(budgets.id, id));

    await audit.log(
      {
        action: "budget.approve",
        entityType: "budget",
        entityId: id,
        actorId: actor.userId,
        before: { status: "draft" },
        after: { status: "approved", docNo },
      },
      tx,
    );

    return requireBudget(tx, id);
  });
}
