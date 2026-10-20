import { eq } from "drizzle-orm";

import { shifts } from "@/db/schema";
import type { CreateShiftInput, UpdateShiftInput } from "@/modules/hr/schemas";
import { assertCan } from "@/modules/hr/_refs";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { conflict, notFound } from "@/server/errors";
import type { AuthContext } from "@/server/authz";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const columns = {
  id: shifts.id,
  code: shifts.code,
  name: shifts.name,
  workStart: shifts.workStart,
  workEnd: shifts.workEnd,
  isActive: shifts.isActive,
  createdAt: shifts.createdAt,
  updatedAt: shifts.updatedAt,
};

async function requireShift(tx: Tx | typeof db, id: string) {
  const [row] = await tx.select(columns).from(shifts).where(eq(shifts.id, id)).limit(1);
  if (!row) throw notFound("Shift tidak ditemukan.");
  return row;
}

export async function listShifts(actor: AuthContext, externalTx?: Tx) {
  assertCan(actor, "hr.shifts.read");
  const reader = externalTx ?? db;
  return reader.select(columns).from(shifts).orderBy(shifts.code);
}

export async function getShift(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "hr.shifts.read");
  return requireShift(externalTx ?? db, id);
}

export async function createShift(actor: AuthContext, input: CreateShiftInput, externalTx?: Tx) {
  assertCan(actor, "hr.shifts.manage");
  const run = async (tx: Tx) => {
    const [existing] = await tx.select({ id: shifts.id }).from(shifts).where(eq(shifts.code, input.code)).limit(1);
    if (existing) throw conflict("Kode shift sudah dipakai.");

    const values = {
      code: input.code,
      name: input.name,
      workStart: input.workStart ?? null,
      workEnd: input.workEnd ?? null,
    };
    const [created] = await tx
      .insert(shifts)
      .values({ ...values, isActive: true, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: shifts.id });
    if (!created) throw new Error("Gagal membuat shift.");

    await audit.log({ action: "hr.shift.create", entityType: "shift", entityId: created.id, actorId: actor.userId, after: values }, tx);
    return requireShift(tx, created.id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function updateShift(actor: AuthContext, id: string, input: UpdateShiftInput, externalTx?: Tx) {
  assertCan(actor, "hr.shifts.manage");
  const run = async (tx: Tx) => {
    const current = await requireShift(tx, id);
    const next = {
      name: input.name ?? current.name,
      workStart: input.workStart === undefined ? current.workStart : input.workStart,
      workEnd: input.workEnd === undefined ? current.workEnd : input.workEnd,
      isActive: input.isActive ?? current.isActive,
    };
    await tx.update(shifts).set({ ...next, updatedBy: actor.userId, updatedAt: new Date() }).where(eq(shifts.id, id));
    await audit.log({ action: "hr.shift.update", entityType: "shift", entityId: id, actorId: actor.userId, after: next }, tx);
    return requireShift(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}
