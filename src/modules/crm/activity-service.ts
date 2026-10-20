import { and, desc, eq, type SQL } from "drizzle-orm";

import { crmActivities, crmAccounts, users } from "@/db/schema";
import type { CreateActivityInput } from "@/modules/crm/schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { forbidden, notFound } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

const activityColumns = {
  id: crmActivities.id,
  accountId: crmActivities.accountId,
  accountName: crmAccounts.name,
  contactId: crmActivities.contactId,
  leadId: crmActivities.leadId,
  opportunityId: crmActivities.opportunityId,
  type: crmActivities.type,
  subject: crmActivities.subject,
  description: crmActivities.description,
  activityDate: crmActivities.activityDate,
  assignedTo: crmActivities.assignedTo,
  assignedToName: users.name,
  isCompleted: crmActivities.isCompleted,
  createdAt: crmActivities.createdAt,
};

function actQuery(reader: Tx | typeof db) {
  return reader
    .select(activityColumns)
    .from(crmActivities)
    .leftJoin(crmAccounts, eq(crmAccounts.id, crmActivities.accountId))
    .leftJoin(users, eq(users.id, crmActivities.assignedTo));
}

export async function listActivities(actor: AuthContext, filters: { accountId?: string; opportunityId?: string } = {}, externalTx?: Tx) {
  assertCan(actor, "crm.activities.read");
  const reader = externalTx ?? db;
  const conditions: (SQL | undefined)[] = [
    filters.accountId ? eq(crmActivities.accountId, filters.accountId) : undefined,
    filters.opportunityId ? eq(crmActivities.opportunityId, filters.opportunityId) : undefined,
  ];
  return actQuery(reader).where(and(...conditions)).orderBy(desc(crmActivities.activityDate));
}

export async function getActivity(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "crm.activities.read");
  const [row] = await actQuery(externalTx ?? db).where(eq(crmActivities.id, id)).limit(1);
  if (!row) throw notFound("Aktivitas tidak ditemukan.");
  return row;
}

export async function createActivity(actor: AuthContext, input: CreateActivityInput, externalTx?: Tx) {
  assertCan(actor, "crm.activities.manage");

  const run = async (tx: Tx) => {
    const [row] = await tx
      .insert(crmActivities)
      .values({ ...input, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: crmActivities.id });
    await audit.log({ action: "crm.activity.create", entityType: "crm_activities", entityId: row!.id, actorId: actor.userId }, tx);
    return getActivity(actor, row!.id, tx);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function completeActivity(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "crm.activities.manage");

  const run = async (tx: Tx) => {
    await tx.update(crmActivities).set({ isCompleted: true, updatedAt: new Date(), updatedBy: actor.userId }).where(eq(crmActivities.id, id));
    await audit.log({ action: "crm.activity.complete", entityType: "crm_activities", entityId: id, actorId: actor.userId }, tx);
    return getActivity(actor, id, tx);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}
