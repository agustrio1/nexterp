import { and, asc, eq } from "drizzle-orm";

import { performanceEvaluations } from "@/db/schema";
import type { CreateEvaluationInput, UpdateEvaluationInput } from "@/modules/hr/schemas";
import { assertCan, requireActiveEmployee } from "@/modules/hr/_refs";
import { toDb } from "@/lib/money";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { conflict, notFound } from "@/server/errors";
import type { AuthContext } from "@/server/authz";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const columns = {
  id: performanceEvaluations.id,
  employeeId: performanceEvaluations.employeeId,
  periodLabel: performanceEvaluations.periodLabel,
  reviewerId: performanceEvaluations.reviewerId,
  score: performanceEvaluations.score,
  rating: performanceEvaluations.rating,
  status: performanceEvaluations.status,
  notes: performanceEvaluations.notes,
  createdAt: performanceEvaluations.createdAt,
  updatedAt: performanceEvaluations.updatedAt,
};

async function requireEvaluation(reader: Tx | typeof db, id: string) {
  const [row] = await reader.select(columns).from(performanceEvaluations).where(eq(performanceEvaluations.id, id)).limit(1);
  if (!row) throw notFound("Evaluasi tidak ditemukan.");
  return row;
}

export async function listEvaluations(actor: AuthContext, employeeId: string | undefined, externalTx?: Tx) {
  assertCan(actor, "hr.evaluations.read");
  const reader = externalTx ?? db;
  const base = reader.select(columns).from(performanceEvaluations);
  const q = employeeId ? base.where(eq(performanceEvaluations.employeeId, employeeId)) : base;
  return q.orderBy(asc(performanceEvaluations.periodLabel));
}

export async function createEvaluation(actor: AuthContext, input: CreateEvaluationInput, externalTx?: Tx) {
  assertCan(actor, "hr.evaluations.manage");
  const run = async (tx: Tx) => {
    await requireActiveEmployee(tx, input.employeeId);
    const [existing] = await tx
      .select({ id: performanceEvaluations.id })
      .from(performanceEvaluations)
      .where(and(eq(performanceEvaluations.employeeId, input.employeeId), eq(performanceEvaluations.periodLabel, input.periodLabel)))
      .limit(1);
    if (existing) throw conflict("Evaluasi untuk periode ini sudah ada.");

    const values = {
      employeeId: input.employeeId,
      periodLabel: input.periodLabel,
      reviewerId: input.reviewerId ?? null,
      score: input.score ? toDb(input.score, 2) : null,
      rating: input.rating ?? null,
      status: input.status ?? "draft",
      notes: input.notes ?? null,
    };
    const [created] = await tx
      .insert(performanceEvaluations)
      .values({ ...values, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: performanceEvaluations.id });
    if (!created) throw new Error("Gagal membuat evaluasi.");
    await audit.log({ action: "hr.evaluation.create", entityType: "performance_evaluation", entityId: created.id, actorId: actor.userId, after: { employeeId: values.employeeId, periodLabel: values.periodLabel } }, tx);
    return requireEvaluation(tx, created.id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function updateEvaluation(actor: AuthContext, id: string, input: UpdateEvaluationInput, externalTx?: Tx) {
  assertCan(actor, "hr.evaluations.manage");
  const run = async (tx: Tx) => {
    const current = await requireEvaluation(tx, id);
    const next = {
      reviewerId: input.reviewerId === undefined ? current.reviewerId : input.reviewerId,
      score: input.score === undefined ? current.score : input.score ? toDb(input.score, 2) : null,
      rating: input.rating === undefined ? current.rating : input.rating,
      status: input.status ?? current.status,
      notes: input.notes === undefined ? current.notes : input.notes,
    };
    await tx.update(performanceEvaluations).set({ ...next, updatedBy: actor.userId, updatedAt: new Date() }).where(eq(performanceEvaluations.id, id));
    await audit.log({ action: "hr.evaluation.update", entityType: "performance_evaluation", entityId: id, actorId: actor.userId, after: next }, tx);
    return requireEvaluation(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}
