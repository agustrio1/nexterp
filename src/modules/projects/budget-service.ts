import { asc, eq } from "drizzle-orm";

import { chartAccounts, projectBudgets } from "@/db/schema";
import type { CreateProjectBudgetInput, UpdateProjectBudgetInput } from "@/modules/projects/schemas";
import { assertCan, inTx, requireProject, type Reader, type Tx } from "@/modules/projects/_refs";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { businessRule, notFound } from "@/server/errors";
import type { AuthContext } from "@/server/authz";

const columns = {
  id: projectBudgets.id,
  projectId: projectBudgets.projectId,
  accountId: projectBudgets.accountId,
  periodKey: projectBudgets.periodKey,
  amount: projectBudgets.amount,
  notes: projectBudgets.notes,
  createdAt: projectBudgets.createdAt,
  updatedAt: projectBudgets.updatedAt,
};

async function rowWithAccount(reader: Reader, id: string) {
  const [row] = await reader
    .select({ ...columns, accountCode: chartAccounts.code, accountName: chartAccounts.name })
    .from(projectBudgets)
    .leftJoin(chartAccounts, eq(chartAccounts.id, projectBudgets.accountId))
    .where(eq(projectBudgets.id, id))
    .limit(1);
  if (!row) throw notFound("Anggaran proyek tidak ditemukan.");
  return row;
}

export async function listProjectBudgets(actor: AuthContext, projectId: string, externalTx?: Tx) {
  assertCan(actor, "projects.master.read");
  const reader: Reader = externalTx ?? db;
  await requireProject(reader, projectId);
  return reader
    .select({ ...columns, accountCode: chartAccounts.code, accountName: chartAccounts.name })
    .from(projectBudgets)
    .leftJoin(chartAccounts, eq(chartAccounts.id, projectBudgets.accountId))
    .where(eq(projectBudgets.projectId, projectId))
    .orderBy(asc(chartAccounts.code), asc(projectBudgets.periodKey));
}

/**
 * Tambah anggaran proyek (per akun dan/atau periode; NULL = agregat).
 * Duplikasi kombinasi ditegakkan unique index parsial DB; pra-check di sini
 * memberi pesan bisnis yang ramah.
 */
export async function createProjectBudget(
  actor: AuthContext,
  projectId: string,
  input: CreateProjectBudgetInput,
  externalTx?: Tx,
) {
  assertCan(actor, "projects.budgets.manage");
  return inTx(externalTx, async (tx) => {
    await requireProject(tx, projectId);
    if (input.accountId) {
      const [account] = await tx
        .select({ id: chartAccounts.id, isActive: chartAccounts.isActive, isPostable: chartAccounts.isPostable })
        .from(chartAccounts)
        .where(eq(chartAccounts.id, input.accountId))
        .limit(1);
      if (!account) throw notFound("Akun bagan akun tidak ditemukan.");
      if (!account.isActive || !account.isPostable) {
        throw businessRule("Anggaran proyek hanya boleh pada akun postable yang aktif.");
      }
    }
    const [created] = await tx
      .insert(projectBudgets)
      .values({
        projectId,
        accountId: input.accountId ?? null,
        periodKey: input.periodKey ?? null,
        amount: input.amount,
        notes: input.notes ?? null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: projectBudgets.id });
    if (!created) throw new Error("Gagal membuat anggaran proyek.");
    await audit.log(
      { action: "projects.budget.create", entityType: "project_budget", entityId: created.id, actorId: actor.userId, after: { projectId, accountId: input.accountId ?? null, periodKey: input.periodKey ?? null, amount: input.amount } },
      tx,
    );
    return rowWithAccount(tx, created.id);
  });
}

export async function updateProjectBudget(
  actor: AuthContext,
  projectId: string,
  id: string,
  input: UpdateProjectBudgetInput,
  externalTx?: Tx,
) {
  assertCan(actor, "projects.budgets.manage");
  return inTx(externalTx, async (tx) => {
    const current = await rowWithAccount(tx, id);
    if (current.projectId !== projectId) throw notFound("Anggaran proyek tidak berada di bawah proyek ini.");
    const next = {
      accountId: input.accountId === undefined ? current.accountId : input.accountId,
      periodKey: input.periodKey === undefined ? current.periodKey : input.periodKey,
      amount: input.amount ?? current.amount,
      notes: input.notes === undefined ? current.notes : input.notes,
    };
    await tx
      .update(projectBudgets)
      .set({ ...next, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(projectBudgets.id, id));
    await audit.log(
      { action: "projects.budget.update", entityType: "project_budget", entityId: id, actorId: actor.userId, after: next },
      tx,
    );
    return rowWithAccount(tx, id);
  });
}

/** Hapus anggaran proyek (bukan dokumen finansial; jejak di audit log). */
export async function removeProjectBudget(actor: AuthContext, projectId: string, id: string, externalTx?: Tx) {
  assertCan(actor, "projects.budgets.manage");
  return inTx(externalTx, async (tx) => {
    const row = await rowWithAccount(tx, id);
    if (row.projectId !== projectId) throw notFound("Anggaran proyek tidak berada di bawah proyek ini.");
    await tx.delete(projectBudgets).where(eq(projectBudgets.id, id));
    await audit.log(
      { action: "projects.budget.remove", entityType: "project_budget", entityId: id, actorId: actor.userId, before: { projectId: row.projectId, accountId: row.accountId, periodKey: row.periodKey, amount: row.amount } },
      tx,
    );
    return { id, removed: true };
  });
}
