import { and, asc, eq, type SQL } from "drizzle-orm";

import { crmAccounts, crmOpportunities, crmPipelineStages, users } from "@/db/schema";
import type { CloseOpportunityInput, CreateOpportunityInput, MoveStageInput, UpdateOpportunityInput } from "@/modules/crm/schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { businessRule, forbidden, notFound, validationFailed } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

const oppColumns = {
  id: crmOpportunities.id,
  accountId: crmOpportunities.accountId,
  accountName: crmAccounts.name,
  leadId: crmOpportunities.leadId,
  title: crmOpportunities.title,
  stageId: crmOpportunities.stageId,
  stageName: crmPipelineStages.name,
  status: crmOpportunities.status,
  amount: crmOpportunities.amount,
  currency: crmOpportunities.currency,
  expectedCloseDate: crmOpportunities.expectedCloseDate,
  assignedTo: crmOpportunities.assignedTo,
  assignedToName: users.name,
  probability: crmOpportunities.probability,
  isActive: crmOpportunities.isActive,
  createdAt: crmOpportunities.createdAt,
  updatedAt: crmOpportunities.updatedAt,
};

function oppQuery(reader: Tx | typeof db) {
  return reader
    .select(oppColumns)
    .from(crmOpportunities)
    .innerJoin(crmAccounts, eq(crmAccounts.id, crmOpportunities.accountId))
    .innerJoin(crmPipelineStages, eq(crmPipelineStages.id, crmOpportunities.stageId))
    .leftJoin(users, eq(users.id, crmOpportunities.assignedTo));
}

export async function listOpportunities(actor: AuthContext, filters: { accountId?: string; status?: string } = {}, externalTx?: Tx) {
  assertCan(actor, "crm.opportunities.read");
  const reader = externalTx ?? db;
  const conditions: (SQL | undefined)[] = [
    filters.accountId ? eq(crmOpportunities.accountId, filters.accountId) : undefined,
    filters.status ? eq(crmOpportunities.status, filters.status as "open" | "won" | "lost") : undefined,
  ];
  return oppQuery(reader).where(and(...conditions)).orderBy(asc(crmOpportunities.createdAt));
}

export async function getOpportunity(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "crm.opportunities.read");
  const [row] = await oppQuery(externalTx ?? db).where(eq(crmOpportunities.id, id)).limit(1);
  if (!row) throw notFound("Peluang tidak ditemukan.");
  return row;
}

export async function createOpportunity(actor: AuthContext, input: CreateOpportunityInput, externalTx?: Tx) {
  assertCan(actor, "crm.opportunities.manage");

  const run = async (tx: Tx) => {
    const [account] = await tx.select({ id: crmAccounts.id }).from(crmAccounts).where(eq(crmAccounts.id, input.accountId)).limit(1);
    if (!account) throw validationFailed([{ path: "accountId", message: "Akun tidak ditemukan." }]);

    const [stage] = await tx.select({ id: crmPipelineStages.id }).from(crmPipelineStages).where(eq(crmPipelineStages.id, input.stageId)).limit(1);
    if (!stage) throw validationFailed([{ path: "stageId", message: "Tahap pipeline tidak ditemukan." }]);

    const [row] = await tx
      .insert(crmOpportunities)
      .values({ ...input, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: crmOpportunities.id });

    await audit.log({ action: "crm.opportunity.create", entityType: "crm_opportunities", entityId: row!.id, actorId: actor.userId }, tx);
    return getOpportunity(actor, row!.id, tx);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function updateOpportunity(actor: AuthContext, id: string, input: UpdateOpportunityInput, externalTx?: Tx) {
  assertCan(actor, "crm.opportunities.manage");

  const run = async (tx: Tx) => {
    const [current] = await tx.select({ id: crmOpportunities.id, status: crmOpportunities.status }).from(crmOpportunities).where(eq(crmOpportunities.id, id)).for("update").limit(1);
    if (!current) throw notFound("Peluang tidak ditemukan.");
    if (current.status !== "open") throw businessRule("Peluang yang sudah ditutup tidak dapat diubah.");

    const next: Record<string, unknown> = { updatedAt: new Date(), updatedBy: actor.userId };
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) next[key] = value;
    }

    await tx.update(crmOpportunities).set(next).where(eq(crmOpportunities.id, id));
    await audit.log({ action: "crm.opportunity.update", entityType: "crm_opportunities", entityId: id, actorId: actor.userId }, tx);
    return getOpportunity(actor, id, tx);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function moveStage(actor: AuthContext, id: string, input: MoveStageInput, externalTx?: Tx) {
  assertCan(actor, "crm.opportunities.manage");

  const run = async (tx: Tx) => {
    const [current] = await tx.select({ id: crmOpportunities.id, status: crmOpportunities.status }).from(crmOpportunities).where(eq(crmOpportunities.id, id)).for("update").limit(1);
    if (!current) throw notFound("Peluang tidak ditemukan.");
    if (current.status !== "open") throw businessRule("Peluang yang sudah ditutup tidak dapat dipindahkan.");

    const [stage] = await tx.select({ id: crmPipelineStages.id }).from(crmPipelineStages).where(eq(crmPipelineStages.id, input.stageId)).limit(1);
    if (!stage) throw validationFailed([{ path: "stageId", message: "Tahap pipeline tidak ditemukan." }]);

    await tx.update(crmOpportunities).set({ stageId: input.stageId, updatedAt: new Date(), updatedBy: actor.userId }).where(eq(crmOpportunities.id, id));
    await audit.log({ action: "crm.opportunity.move_stage", entityType: "crm_opportunities", entityId: id, actorId: actor.userId }, tx);
    return getOpportunity(actor, id, tx);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function closeOpportunity(actor: AuthContext, id: string, input: CloseOpportunityInput, externalTx?: Tx) {
  assertCan(actor, "crm.opportunities.manage");

  const run = async (tx: Tx) => {
    const [current] = await tx.select({ id: crmOpportunities.id, status: crmOpportunities.status }).from(crmOpportunities).where(eq(crmOpportunities.id, id)).for("update").limit(1);
    if (!current) throw notFound("Peluang tidak ditemukan.");
    if (current.status !== "open") throw businessRule("Peluang sudah ditutup.");

    await tx.update(crmOpportunities).set({ status: input.status, updatedAt: new Date(), updatedBy: actor.userId }).where(eq(crmOpportunities.id, id));
    await audit.log({ action: `crm.opportunity.${input.status}`, entityType: "crm_opportunities", entityId: id, actorId: actor.userId }, tx);
    return getOpportunity(actor, id, tx);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}
