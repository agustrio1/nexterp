import { and, asc, desc, eq } from "drizzle-orm";

import {
  employeeCompensations,
  payrollAdjustments,
  payrollComponentValues,
} from "@/db/schema";
import type {
  CreateAdjustmentInput,
  SetComponentValueInput,
  SetCompensationInput,
  UpdateAdjustmentInput,
} from "@/modules/payroll/schemas";
import { assertCan, inTx, requireActiveComponent, type Tx } from "@/modules/payroll/_refs";
import { requireActiveEmployee } from "@/modules/hr/_refs";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { businessRule, notFound } from "@/server/errors";
import type { AuthContext } from "@/server/authz";

const compColumns = {
  id: employeeCompensations.id,
  employeeId: employeeCompensations.employeeId,
  structureId: employeeCompensations.structureId,
  baseSalary: employeeCompensations.baseSalary,
  effectiveFrom: employeeCompensations.effectiveFrom,
  createdAt: employeeCompensations.createdAt,
  updatedAt: employeeCompensations.updatedAt,
};

const valueColumns = {
  id: payrollComponentValues.id,
  employeeId: payrollComponentValues.employeeId,
  componentId: payrollComponentValues.componentId,
  amount: payrollComponentValues.amount,
  percentValue: payrollComponentValues.percentValue,
  effectiveFrom: payrollComponentValues.effectiveFrom,
};

const adjColumns = {
  id: payrollAdjustments.id,
  employeeId: payrollAdjustments.employeeId,
  periodId: payrollAdjustments.periodId,
  componentId: payrollAdjustments.componentId,
  kind: payrollAdjustments.kind,
  amount: payrollAdjustments.amount,
  effectiveFrom: payrollAdjustments.effectiveFrom,
  isActive: payrollAdjustments.isActive,
  notes: payrollAdjustments.notes,
};

/* ------------------------- Gaji pokok ------------------------- */

export async function listCompensations(actor: AuthContext, employeeId: string, externalTx?: Tx) {
  assertCan(actor, "payroll.structures.read");
  const reader = externalTx ?? db;
  return reader
    .select(compColumns)
    .from(employeeCompensations)
    .where(eq(employeeCompensations.employeeId, employeeId))
    .orderBy(desc(employeeCompensations.effectiveFrom));
}

/**
 * Pasang/timpa gaji pokok berlaku-tanggal. Bila sudah ada entri pada tanggal sama,
 * nilainya diperbarui (upsert by unique employee+effectiveFrom).
 */
export async function setCompensation(actor: AuthContext, input: SetCompensationInput, externalTx?: Tx) {
  assertCan(actor, "payroll.structures.manage");
  return inTx(externalTx, async (tx) => {
    await requireActiveEmployee(tx, input.employeeId);
    const [existing] = await tx
      .select({ id: employeeCompensations.id })
      .from(employeeCompensations)
      .where(
        and(
          eq(employeeCompensations.employeeId, input.employeeId),
          eq(employeeCompensations.effectiveFrom, input.effectiveFrom),
        ),
      )
      .limit(1);

    if (existing) {
      await tx
        .update(employeeCompensations)
        .set({
          structureId: input.structureId ?? null,
          baseSalary: input.baseSalary,
          updatedBy: actor.userId,
          updatedAt: new Date(),
        })
        .where(eq(employeeCompensations.id, existing.id));
      await audit.log(
        { action: "payroll.compensation.update", entityType: "employee_compensation", entityId: existing.id, actorId: actor.userId, after: { baseSalary: input.baseSalary } },
        tx,
      );
      return requireCompensation(tx, existing.id);
    }

    const [created] = await tx
      .insert(employeeCompensations)
      .values({
        employeeId: input.employeeId,
        structureId: input.structureId ?? null,
        baseSalary: input.baseSalary,
        effectiveFrom: input.effectiveFrom,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: employeeCompensations.id });
    if (!created) throw new Error("Gagal menyimpan kompensasi karyawan.");
    await audit.log(
      { action: "payroll.compensation.create", entityType: "employee_compensation", entityId: created.id, actorId: actor.userId, after: { employeeId: input.employeeId, baseSalary: input.baseSalary } },
      tx,
    );
    return requireCompensation(tx, created.id);
  });
}

async function requireCompensation(tx: Tx, id: string) {
  const [row] = await tx.select(compColumns).from(employeeCompensations).where(eq(employeeCompensations.id, id)).limit(1);
  if (!row) throw notFound("Kompensasi karyawan tidak ditemukan.");
  return row;
}

/* ----------------------- Nilai komponen ----------------------- */

export async function listComponentValues(actor: AuthContext, employeeId: string, externalTx?: Tx) {
  assertCan(actor, "payroll.structures.read");
  const reader = externalTx ?? db;
  return reader
    .select(valueColumns)
    .from(payrollComponentValues)
    .where(eq(payrollComponentValues.employeeId, employeeId))
    .orderBy(desc(payrollComponentValues.effectiveFrom));
}

export async function setComponentValue(actor: AuthContext, input: SetComponentValueInput, externalTx?: Tx) {
  assertCan(actor, "payroll.structures.manage");
  return inTx(externalTx, async (tx) => {
    await requireActiveEmployee(tx, input.employeeId);
    const component = await requireActiveComponent(tx, input.componentId);
    if (input.amount == null && input.percentValue == null) {
      throw businessRule("Nilai komponen wajib mengisi amount atau percentValue.");
    }
    if (component.basis === "fixed" && input.amount == null) {
      throw businessRule(`Komponen ${component.code} (fixed) membutuhkan amount.`);
    }
    if (component.basis === "percentage_of_base" && input.percentValue == null) {
      throw businessRule(`Komponen ${component.code} (percentage_of_base) membutuhkan percentValue.`);
    }

    const [existing] = await tx
      .select({ id: payrollComponentValues.id })
      .from(payrollComponentValues)
      .where(
        and(
          eq(payrollComponentValues.employeeId, input.employeeId),
          eq(payrollComponentValues.componentId, input.componentId),
          eq(payrollComponentValues.effectiveFrom, input.effectiveFrom),
        ),
      )
      .limit(1);

    const values = {
      amount: input.amount ?? null,
      percentValue: input.percentValue ?? null,
    };

    if (existing) {
      await tx
        .update(payrollComponentValues)
        .set({ ...values, updatedBy: actor.userId, updatedAt: new Date() })
        .where(eq(payrollComponentValues.id, existing.id));
      await audit.log(
        { action: "payroll.component_value.update", entityType: "payroll_component_value", entityId: existing.id, actorId: actor.userId, after: values },
        tx,
      );
      return requireValue(tx, existing.id);
    }

    const [created] = await tx
      .insert(payrollComponentValues)
      .values({
        employeeId: input.employeeId,
        componentId: input.componentId,
        effectiveFrom: input.effectiveFrom,
        ...values,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: payrollComponentValues.id });
    if (!created) throw new Error("Gagal menyimpan nilai komponen.");
    await audit.log(
      { action: "payroll.component_value.create", entityType: "payroll_component_value", entityId: created.id, actorId: actor.userId, after: { employeeId: input.employeeId, componentId: input.componentId, ...values } },
      tx,
    );
    return requireValue(tx, created.id);
  });
}

async function requireValue(tx: Tx, id: string) {
  const [row] = await tx.select(valueColumns).from(payrollComponentValues).where(eq(payrollComponentValues.id, id)).limit(1);
  if (!row) throw notFound("Nilai komponen tidak ditemukan.");
  return row;
}

/* ------------------------- Penyesuaian ------------------------ */

export async function listAdjustments(
  actor: AuthContext,
  query: { employeeId?: string; periodId?: string } = {},
  externalTx?: Tx,
) {
  assertCan(actor, "payroll.adjustments.read");
  const reader = externalTx ?? db;
  return reader
    .select(adjColumns)
    .from(payrollAdjustments)
    .where(
      and(
        query.employeeId === undefined ? undefined : eq(payrollAdjustments.employeeId, query.employeeId),
        query.periodId === undefined ? undefined : eq(payrollAdjustments.periodId, query.periodId),
      ),
    )
    .orderBy(asc(payrollAdjustments.effectiveFrom));
}

export async function createAdjustment(actor: AuthContext, input: CreateAdjustmentInput, externalTx?: Tx) {
  assertCan(actor, "payroll.adjustments.manage");
  return inTx(externalTx, async (tx) => {
    await requireActiveEmployee(tx, input.employeeId);
    if (input.componentId) await requireActiveComponent(tx, input.componentId);
    const [created] = await tx
      .insert(payrollAdjustments)
      .values({
        employeeId: input.employeeId,
        periodId: input.periodId ?? null,
        componentId: input.componentId ?? null,
        kind: input.kind,
        amount: input.amount,
        effectiveFrom: input.effectiveFrom,
        notes: input.notes ?? null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: payrollAdjustments.id });
    if (!created) throw new Error("Gagal membuat penyesuaian.");
    await audit.log(
      { action: "payroll.adjustment.create", entityType: "payroll_adjustment", entityId: created.id, actorId: actor.userId, after: { employeeId: input.employeeId, kind: input.kind, amount: input.amount } },
      tx,
    );
    return requireAdjustment(tx, created.id);
  });
}

export async function updateAdjustment(
  actor: AuthContext,
  id: string,
  input: UpdateAdjustmentInput,
  externalTx?: Tx,
) {
  assertCan(actor, "payroll.adjustments.manage");
  return inTx(externalTx, async (tx) => {
    const current = await requireAdjustment(tx, id);
    const next = {
      amount: input.amount ?? current.amount,
      isActive: input.isActive ?? current.isActive,
      notes: input.notes === undefined ? current.notes : input.notes,
    };
    await tx
      .update(payrollAdjustments)
      .set({ ...next, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(payrollAdjustments.id, id));
    await audit.log(
      { action: "payroll.adjustment.update", entityType: "payroll_adjustment", entityId: id, actorId: actor.userId, after: next },
      tx,
    );
    return requireAdjustment(tx, id);
  });
}

async function requireAdjustment(tx: Tx, id: string) {
  const [row] = await tx.select(adjColumns).from(payrollAdjustments).where(eq(payrollAdjustments.id, id)).limit(1);
  if (!row) throw notFound("Penyesuaian tidak ditemukan.");
  return row;
}
