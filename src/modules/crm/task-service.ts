import { and, asc, eq, type SQL } from "drizzle-orm";

import { crmAccounts, crmOpportunities, crmTasks, users } from "@/db/schema";
import type { CreateTaskInput, UpdateTaskInput } from "@/modules/crm/schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { forbidden, notFound } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

const taskColumns = {
  id: crmTasks.id,
  accountId: crmTasks.accountId,
  accountName: crmAccounts.name,
  opportunityId: crmTasks.opportunityId,
  title: crmTasks.title,
  description: crmTasks.description,
  dueDate: crmTasks.dueDate,
  status: crmTasks.status,
  assignedTo: crmTasks.assignedTo,
  assignedToName: users.name,
  isCompleted: crmTasks.isCompleted,
  createdAt: crmTasks.createdAt,
  updatedAt: crmTasks.updatedAt,
};

function taskQuery(reader: Tx | typeof db) {
  return reader
    .select(taskColumns)
    .from(crmTasks)
    .leftJoin(crmAccounts, eq(crmAccounts.id, crmTasks.accountId))
    .leftJoin(crmOpportunities, eq(crmOpportunities.id, crmTasks.opportunityId))
    .leftJoin(users, eq(users.id, crmTasks.assignedTo));
}

export async function listTasks(actor: AuthContext, filters: { accountId?: string; status?: string } = {}, externalTx?: Tx) {
  assertCan(actor, "crm.tasks.read");
  const reader = externalTx ?? db;
  const conditions: (SQL | undefined)[] = [
    filters.accountId ? eq(crmTasks.accountId, filters.accountId) : undefined,
    filters.status ? eq(crmTasks.status, filters.status as "pending" | "completed" | "overdue") : undefined,
  ];
  return taskQuery(reader).where(and(...conditions)).orderBy(asc(crmTasks.dueDate));
}

export async function getTask(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "crm.tasks.read");
  const [row] = await taskQuery(externalTx ?? db).where(eq(crmTasks.id, id)).limit(1);
  if (!row) throw notFound("Tugas tidak ditemukan.");
  return row;
}

export async function createTask(actor: AuthContext, input: CreateTaskInput, externalTx?: Tx) {
  assertCan(actor, "crm.tasks.manage");
  const run = async (tx: Tx) => {
    const [row] = await tx.insert(crmTasks).values({ ...input, createdBy: actor.userId, updatedBy: actor.userId }).returning({ id: crmTasks.id });
    await audit.log({ action: "crm.task.create", entityType: "crm_tasks", entityId: row!.id, actorId: actor.userId }, tx);
    return getTask(actor, row!.id, tx);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function updateTask(actor: AuthContext, id: string, input: UpdateTaskInput, externalTx?: Tx) {
  assertCan(actor, "crm.tasks.manage");
  const run = async (tx: Tx) => {
    const [current] = await tx.select({ id: crmTasks.id }).from(crmTasks).where(eq(crmTasks.id, id)).for("update").limit(1);
    if (!current) throw notFound("Tugas tidak ditemukan.");
    const next: Record<string, unknown> = { updatedAt: new Date(), updatedBy: actor.userId };
    for (const [key, value] of Object.entries(input)) { if (value !== undefined) next[key] = value; }
    if (input.isCompleted) next.status = "completed";
    await tx.update(crmTasks).set(next).where(eq(crmTasks.id, id));
    await audit.log({ action: "crm.task.update", entityType: "crm_tasks", entityId: id, actorId: actor.userId }, tx);
    return getTask(actor, id, tx);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}
