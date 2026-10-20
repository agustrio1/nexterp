import { and, asc, eq } from "drizzle-orm";

import { crmAccountSegments, crmSegments } from "@/db/schema";
import type { AssignSegmentInput, CreateSegmentInput, UpdateSegmentInput } from "@/modules/crm/schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { conflict, forbidden, notFound } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

const segmentColumns = {
  id: crmSegments.id,
  name: crmSegments.name,
  description: crmSegments.description,
  criteria: crmSegments.criteria,
  isActive: crmSegments.isActive,
  createdAt: crmSegments.createdAt,
  updatedAt: crmSegments.updatedAt,
};

export async function listSegments(actor: AuthContext, externalTx?: Tx) {
  assertCan(actor, "crm.segments.read");
  const reader = externalTx ?? db;
  return reader.select(segmentColumns).from(crmSegments).orderBy(asc(crmSegments.name));
}

export async function createSegment(actor: AuthContext, input: CreateSegmentInput, externalTx?: Tx) {
  assertCan(actor, "crm.segments.manage");
  const run = async (tx: Tx) => {
    const [dup] = await tx.select({ id: crmSegments.id }).from(crmSegments).where(eq(crmSegments.name, input.name)).limit(1);
    if (dup) throw conflict(`Segmen "${input.name}" sudah ada.`);
    const [row] = await tx.insert(crmSegments).values({ ...input, createdBy: actor.userId, updatedBy: actor.userId }).returning(segmentColumns);
    await audit.log({ action: "crm.segment.create", entityType: "crm_segments", entityId: row!.id, actorId: actor.userId }, tx);
    return row!;
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function updateSegment(actor: AuthContext, id: string, input: UpdateSegmentInput, externalTx?: Tx) {
  assertCan(actor, "crm.segments.manage");
  const run = async (tx: Tx) => {
    const [current] = await tx.select({ id: crmSegments.id }).from(crmSegments).where(eq(crmSegments.id, id)).for("update").limit(1);
    if (!current) throw notFound("Segmen tidak ditemukan.");
    const next: Record<string, unknown> = { updatedAt: new Date(), updatedBy: actor.userId };
    for (const [key, value] of Object.entries(input)) { if (value !== undefined) next[key] = value; }
    const [row] = await tx.update(crmSegments).set(next).where(eq(crmSegments.id, id)).returning(segmentColumns);
    await audit.log({ action: "crm.segment.update", entityType: "crm_segments", entityId: id, actorId: actor.userId }, tx);
    return row!;
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function assignSegment(actor: AuthContext, input: AssignSegmentInput, externalTx?: Tx) {
  assertCan(actor, "crm.segments.manage");
  const run = async (tx: Tx) => {
    await tx.insert(crmAccountSegments).values({ accountId: input.accountId, segmentId: input.segmentId }).onConflictDoNothing();
    await audit.log({ action: "crm.segment.assign", entityType: "crm_account_segments", entityId: `${input.accountId}:${input.segmentId}`, actorId: actor.userId }, tx);
    return { accountId: input.accountId, segmentId: input.segmentId };
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function unassignSegment(actor: AuthContext, input: AssignSegmentInput, externalTx?: Tx) {
  assertCan(actor, "crm.segments.manage");
  const run = async (tx: Tx) => {
    await tx.delete(crmAccountSegments).where(and(eq(crmAccountSegments.accountId, input.accountId), eq(crmAccountSegments.segmentId, input.segmentId)));
    await audit.log({ action: "crm.segment.unassign", entityType: "crm_account_segments", entityId: `${input.accountId}:${input.segmentId}`, actorId: actor.userId }, tx);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}
