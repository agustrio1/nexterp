import { asc, eq } from "drizzle-orm";

import { crmPipelineStages } from "@/db/schema";
import type { CreateStageInput, UpdateStageInput } from "@/modules/crm/schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { conflict, forbidden, notFound } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

const stageColumns = {
  id: crmPipelineStages.id,
  name: crmPipelineStages.name,
  position: crmPipelineStages.position,
  probability: crmPipelineStages.probability,
  isActive: crmPipelineStages.isActive,
  createdAt: crmPipelineStages.createdAt,
  updatedAt: crmPipelineStages.updatedAt,
};

export async function listStages(actor: AuthContext, externalTx?: Tx) {
  assertCan(actor, "crm.pipeline.read");
  const reader = externalTx ?? db;
  return reader.select(stageColumns).from(crmPipelineStages).orderBy(asc(crmPipelineStages.position));
}

export async function createStage(actor: AuthContext, input: CreateStageInput, externalTx?: Tx) {
  assertCan(actor, "crm.pipeline.manage");

  const run = async (tx: Tx) => {
    const [dup] = await tx.select({ id: crmPipelineStages.id }).from(crmPipelineStages).where(eq(crmPipelineStages.position, input.position)).limit(1);
    if (dup) throw conflict(`Posisi ${input.position} sudah dipakai.`);

    const [row] = await tx
      .insert(crmPipelineStages)
      .values({ ...input, createdBy: actor.userId, updatedBy: actor.userId })
      .returning(stageColumns);

    await audit.log({ action: "crm.pipeline.create_stage", entityType: "crm_pipeline_stages", entityId: row!.id, actorId: actor.userId }, tx);
    return row!;
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function updateStage(actor: AuthContext, id: string, input: UpdateStageInput, externalTx?: Tx) {
  assertCan(actor, "crm.pipeline.manage");

  const run = async (tx: Tx) => {
    const [current] = await tx.select({ id: crmPipelineStages.id }).from(crmPipelineStages).where(eq(crmPipelineStages.id, id)).for("update").limit(1);
    if (!current) throw notFound("Tahap pipeline tidak ditemukan.");

    if (input.position !== undefined) {
      const [dup] = await tx.select({ id: crmPipelineStages.id }).from(crmPipelineStages).where(eq(crmPipelineStages.position, input.position)).limit(1);
      if (dup && dup.id !== id) throw conflict(`Posisi ${input.position} sudah dipakai.`);
    }

    const next: Record<string, unknown> = { updatedAt: new Date(), updatedBy: actor.userId };
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) next[key] = value;
    }

    const [row] = await tx.update(crmPipelineStages).set(next).where(eq(crmPipelineStages.id, id)).returning(stageColumns);
    await audit.log({ action: "crm.pipeline.update_stage", entityType: "crm_pipeline_stages", entityId: id, actorId: actor.userId }, tx);
    return row!;
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}
