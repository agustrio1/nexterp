import { and, asc, eq, type SQL } from "drizzle-orm";

import { positions } from "@/db/schema";
import type {
  CreatePositionInput,
  ListPositionsQuery,
  UpdatePositionInput,
} from "@/modules/hr/schemas";
import { assertActiveDepartment, assertCan } from "@/modules/hr/_refs";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { conflict, notFound } from "@/server/errors";
import type { AuthContext } from "@/server/authz";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const columns = {
  id: positions.id,
  code: positions.code,
  name: positions.name,
  departmentId: positions.departmentId,
  jobGrade: positions.jobGrade,
  isActive: positions.isActive,
  createdAt: positions.createdAt,
  updatedAt: positions.updatedAt,
};

async function requirePosition(tx: Tx | typeof db, id: string) {
  const [row] = await tx.select(columns).from(positions).where(eq(positions.id, id)).limit(1);
  if (!row) throw notFound("Jabatan tidak ditemukan.");
  return row;
}

export async function listPosition(actor: AuthContext, query: ListPositionsQuery = {}, externalTx?: Tx) {
  assertCan(actor, "hr.positions.read");
  const reader = externalTx ?? db;
  const conditions: (SQL | undefined)[] = [
    query.isActive === undefined ? undefined : eq(positions.isActive, query.isActive),
    query.departmentId === undefined ? undefined : eq(positions.departmentId, query.departmentId),
  ];
  return reader.select(columns).from(positions).where(and(...conditions)).orderBy(asc(positions.code));
}

export async function getPosition(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "hr.positions.read");
  return requirePosition(externalTx ?? db, id);
}

export async function createPosition(actor: AuthContext, input: CreatePositionInput, externalTx?: Tx) {
  assertCan(actor, "hr.positions.manage");
  const run = async (tx: Tx) => {
    const [existing] = await tx.select({ id: positions.id }).from(positions).where(eq(positions.code, input.code)).limit(1);
    if (existing) throw conflict("Kode jabatan sudah dipakai.");

    const departmentId = input.departmentId ?? null;
    if (departmentId !== null) await assertActiveDepartment(tx, departmentId);

    const values = {
      code: input.code,
      name: input.name,
      departmentId,
      jobGrade: input.jobGrade ?? null,
    };
    const [created] = await tx
      .insert(positions)
      .values({ ...values, isActive: true, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: positions.id });
    if (!created) throw new Error("Gagal membuat jabatan.");

    await audit.log({ action: "hr.position.create", entityType: "position", entityId: created.id, actorId: actor.userId, after: values }, tx);
    return requirePosition(tx, created.id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function updatePosition(actor: AuthContext, id: string, input: UpdatePositionInput, externalTx?: Tx) {
  assertCan(actor, "hr.positions.manage");
  const run = async (tx: Tx) => {
    const current = await requirePosition(tx, id);
    const next = {
      name: input.name ?? current.name,
      departmentId: input.departmentId === undefined ? current.departmentId : input.departmentId,
      jobGrade: input.jobGrade === undefined ? current.jobGrade : input.jobGrade,
      isActive: input.isActive ?? current.isActive,
    };
    if (next.departmentId !== null) await assertActiveDepartment(tx, next.departmentId);

    await tx.update(positions).set({ ...next, updatedBy: actor.userId, updatedAt: new Date() }).where(eq(positions.id, id));
    await audit.log({ action: "hr.position.update", entityType: "position", entityId: id, actorId: actor.userId, after: next }, tx);
    return requirePosition(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}
