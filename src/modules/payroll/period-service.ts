import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";

import { payrollPeriods } from "@/db/schema";
import type { CreatePeriodInput, UpdatePeriodInput } from "@/modules/payroll/schemas";
import { assertCan, inTx, requirePeriod, type Reader, type Tx } from "@/modules/payroll/_refs";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { businessRule, conflict, notFound } from "@/server/errors";
import type { AuthContext } from "@/server/authz";

const columns = {
  id: payrollPeriods.id,
  code: payrollPeriods.code,
  name: payrollPeriods.name,
  periodStart: payrollPeriods.periodStart,
  periodEnd: payrollPeriods.periodEnd,
  branchId: payrollPeriods.branchId,
  status: payrollPeriods.status,
  createdAt: payrollPeriods.createdAt,
  updatedAt: payrollPeriods.updatedAt,
};

async function requirePeriodRow(reader: Reader, id: string) {
  const [row] = await reader
    .select(columns)
    .from(payrollPeriods)
    .where(eq(payrollPeriods.id, id))
    .limit(1);
  if (!row) throw notFound("Periode payroll tidak ditemukan.");
  return row;
}

export async function listPeriods(
  actor: AuthContext,
  query: { status?: "draft" | "finalized" | "posted" | "closed" } = {},
  externalTx?: Tx,
) {
  assertCan(actor, "payroll.periods.read");
  const reader = externalTx ?? db;
  return reader
    .select(columns)
    .from(payrollPeriods)
    .where(query.status === undefined ? undefined : eq(payrollPeriods.status, query.status))
    .orderBy(desc(payrollPeriods.periodStart));
}

export async function getPeriod(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "payroll.periods.read");
  return requirePeriodRow(externalTx ?? db, id);
}

export async function createPeriod(actor: AuthContext, input: CreatePeriodInput, externalTx?: Tx) {
  assertCan(actor, "payroll.periods.manage");
  return inTx(externalTx, async (tx) => {
    if (input.periodEnd < input.periodStart) {
      throw businessRule("Akhir periode tidak boleh sebelum awal periode.");
    }
    const [dup] = await tx
      .select({ id: payrollPeriods.id })
      .from(payrollPeriods)
      .where(eq(payrollPeriods.code, input.code))
      .limit(1);
    if (dup) throw conflict("Kode periode sudah dipakai.");

    // Tolak rentang tumpang tindih pada cakupan cabang yang sama.
    const scope = input.branchId
      ? eq(payrollPeriods.branchId, input.branchId)
      : isNull(payrollPeriods.branchId);
    const [overlap] = await tx
      .select({ id: payrollPeriods.id, code: payrollPeriods.code })
      .from(payrollPeriods)
      .where(
        and(
          scope,
          lte(payrollPeriods.periodStart, input.periodEnd),
          gte(payrollPeriods.periodEnd, input.periodStart),
        ),
      )
      .limit(1);
    if (overlap) throw conflict(`Rentang periode tumpang tindih dengan ${overlap.code}.`);

    const [created] = await tx
      .insert(payrollPeriods)
      .values({
        code: input.code,
        name: input.name,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        branchId: input.branchId ?? null,
        status: "draft",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: payrollPeriods.id });
    if (!created) throw new Error("Gagal membuat periode payroll.");
    await audit.log(
      {
        action: "payroll.period.create",
        entityType: "payroll_period",
        entityId: created.id,
        actorId: actor.userId,
        after: { code: input.code, periodStart: input.periodStart, periodEnd: input.periodEnd },
      },
      tx,
    );
    return requirePeriodRow(tx, created.id);
  });
}

export async function updatePeriod(
  actor: AuthContext,
  id: string,
  input: UpdatePeriodInput,
  externalTx?: Tx,
) {
  assertCan(actor, "payroll.periods.manage");
  return inTx(externalTx, async (tx) => {
    const current = await requirePeriod(tx, id);
    if (current.status !== "draft") throw businessRule("Hanya periode berstatus draft yang dapat diubah.");
    const next = {
      name: input.name ?? current.name,
      branchId: input.branchId === undefined ? current.branchId : input.branchId,
    };
    await tx
      .update(payrollPeriods)
      .set({ ...next, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(payrollPeriods.id, id));
    await audit.log(
      { action: "payroll.period.update", entityType: "payroll_period", entityId: id, actorId: actor.userId, after: next },
      tx,
    );
    return requirePeriodRow(tx, id);
  });
}

/** draft -> finalized. Setelah final, run/kalkulasi boleh dibuat. */
export async function finalizePeriod(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "payroll.periods.manage");
  return transition(actor, id, ["draft"], "finalized", "payroll.period.finalize", externalTx);
}

/** finalized/posted -> closed. Periode tertutup menolak seluruh perubahan. */
export async function closePeriod(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "payroll.periods.manage");
  return transition(actor, id, ["finalized", "posted"], "closed", "payroll.period.close", externalTx);
}

/** Naikkan status periode saat run diposting (finalized -> posted). Dipakai run-service. */
export async function markPeriodPosted(tx: Tx, actor: AuthContext, id: string) {
  const current = await requirePeriod(tx, id);
  if (current.status === "finalized") {
    await tx
      .update(payrollPeriods)
      .set({ status: "posted", updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(payrollPeriods.id, id));
  }
}

async function transition(
  actor: AuthContext,
  id: string,
  allowedFrom: readonly ("draft" | "finalized" | "posted" | "closed")[],
  to: "finalized" | "posted" | "closed",
  action: string,
  externalTx?: Tx,
) {
  return inTx(externalTx, async (tx) => {
    const current = await requirePeriod(tx, id);
    if (!allowedFrom.includes(current.status)) {
      throw businessRule(
        `Periode harus berstatus ${allowedFrom.join("/")} untuk transisi ini (status: ${current.status}).`,
      );
    }
    await tx
      .update(payrollPeriods)
      .set({ status: to, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(payrollPeriods.id, id));
    await audit.log(
      {
        action,
        entityType: "payroll_period",
        entityId: id,
        actorId: actor.userId,
        before: { status: current.status },
        after: { status: to },
      },
      tx,
    );
    return requirePeriodRow(tx, id);
  });
}
