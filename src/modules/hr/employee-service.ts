import { and, asc, eq, type SQL } from "drizzle-orm";

import { employees } from "@/db/schema";
import type {
  CreateEmployeeInput,
  ListEmployeesQuery,
  UpdateEmployeeInput,
} from "@/modules/hr/schemas";
import {
  assertActiveBranch,
  assertActiveDepartment,
  assertActivePosition,
  assertCan,
  assertUserLinkable,
} from "@/modules/hr/_refs";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { businessRule, conflict, notFound, validationFailed } from "@/server/errors";
import type { AuthContext } from "@/server/authz";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const columns = {
  id: employees.id,
  code: employees.code,
  userId: employees.userId,
  firstName: employees.firstName,
  lastName: employees.lastName,
  birthDate: employees.birthDate,
  gender: employees.gender,
  npwp: employees.npwp,
  address: employees.address,
  phone: employees.phone,
  email: employees.email,
  departmentId: employees.departmentId,
  positionId: employees.positionId,
  branchId: employees.branchId,
  managerId: employees.managerId,
  dateJoined: employees.dateJoined,
  status: employees.status,
  isActive: employees.isActive,
  createdAt: employees.createdAt,
  updatedAt: employees.updatedAt,
};

async function requireEmployee(reader: Tx | typeof db, id: string) {
  const [row] = await reader.select(columns).from(employees).where(eq(employees.id, id)).limit(1);
  if (!row) throw notFound("Karyawan tidak ditemukan.");
  return row;
}

async function assertRefsUsable(
  tx: Tx,
  refs: { departmentId: string | null; positionId: string | null; branchId: string | null; managerId: string | null },
  selfId?: string,
): Promise<void> {
  if (refs.departmentId !== null) await assertActiveDepartment(tx, refs.departmentId);
  if (refs.positionId !== null) await assertActivePosition(tx, refs.positionId);
  if (refs.branchId !== null) await assertActiveBranch(tx, refs.branchId);
  if (refs.managerId !== null) {
    if (selfId !== undefined && refs.managerId === selfId) {
      throw businessRule("Karyawan tidak dapat menjadi manajernya sendiri.");
    }
    const [mgr] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, refs.managerId)).limit(1);
    if (!mgr) throw validationFailed([{ path: "managerId", message: "Manajer tidak ditemukan." }]);
  }
}

export async function listEmployees(actor: AuthContext, query: ListEmployeesQuery = {}, externalTx?: Tx) {
  assertCan(actor, "hr.employees.read");
  const reader = externalTx ?? db;
  const conditions: (SQL | undefined)[] = [
    query.isActive === undefined ? undefined : eq(employees.isActive, query.isActive),
    query.departmentId === undefined ? undefined : eq(employees.departmentId, query.departmentId),
    query.branchId === undefined ? undefined : eq(employees.branchId, query.branchId),
    query.status === undefined ? undefined : eq(employees.status, query.status),
  ];
  return reader.select(columns).from(employees).where(and(...conditions)).orderBy(asc(employees.code));
}

export async function getEmployee(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "hr.employees.read");
  return requireEmployee(externalTx ?? db, id);
}

export async function createEmployee(actor: AuthContext, input: CreateEmployeeInput, externalTx?: Tx) {
  assertCan(actor, "hr.employees.manage");
  const run = async (tx: Tx) => {
    const [existing] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.code, input.code)).limit(1);
    if (existing) throw conflict("Kode karyawan sudah dipakai.");

    const userId = input.userId ?? null;
    if (userId !== null) await assertUserLinkable(tx, userId);

    const refs = {
      departmentId: input.departmentId ?? null,
      positionId: input.positionId ?? null,
      branchId: input.branchId ?? null,
      managerId: input.managerId ?? null,
    };
    await assertRefsUsable(tx, refs);

    const values = {
      code: input.code,
      userId,
      firstName: input.firstName,
      lastName: input.lastName ?? null,
      birthDate: input.birthDate ?? null,
      gender: input.gender ?? null,
      npwp: input.npwp ?? null,
      address: input.address ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      ...refs,
      dateJoined: input.dateJoined,
      status: input.status ?? "active",
    };

    const [created] = await tx
      .insert(employees)
      .values({ ...values, isActive: true, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: employees.id });
    if (!created) throw new Error("Gagal membuat karyawan.");

    await audit.log({ action: "hr.employee.create", entityType: "employee", entityId: created.id, actorId: actor.userId, after: { code: values.code, userId, departmentId: values.departmentId } }, tx);
    return requireEmployee(tx, created.id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function updateEmployee(actor: AuthContext, id: string, input: UpdateEmployeeInput, externalTx?: Tx) {
  assertCan(actor, "hr.employees.manage");
  const run = async (tx: Tx) => {
    const current = await requireEmployee(tx, id);

    const userId = input.userId === undefined ? current.userId : input.userId;
    if (userId !== null && userId !== current.userId) await assertUserLinkable(tx, userId);

    const refs = {
      departmentId: input.departmentId === undefined ? current.departmentId : input.departmentId,
      positionId: input.positionId === undefined ? current.positionId : input.positionId,
      branchId: input.branchId === undefined ? current.branchId : input.branchId,
      managerId: input.managerId === undefined ? current.managerId : input.managerId,
    };
    await assertRefsUsable(tx, refs, id);

    const next = {
      userId,
      firstName: input.firstName ?? current.firstName,
      lastName: input.lastName === undefined ? current.lastName : input.lastName,
      birthDate: input.birthDate === undefined ? current.birthDate : input.birthDate,
      gender: input.gender === undefined ? current.gender : input.gender,
      npwp: input.npwp === undefined ? current.npwp : input.npwp,
      address: input.address === undefined ? current.address : input.address,
      phone: input.phone === undefined ? current.phone : input.phone,
      email: input.email === undefined ? current.email : input.email,
      ...refs,
      status: input.status ?? current.status,
      isActive: input.isActive ?? current.isActive,
    };

    await tx.update(employees).set({ ...next, updatedBy: actor.userId, updatedAt: new Date() }).where(eq(employees.id, id));
    await audit.log({ action: "hr.employee.update", entityType: "employee", entityId: id, actorId: actor.userId, after: { status: next.status, isActive: next.isActive } }, tx);
    return requireEmployee(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

/** Melepas tautan login dari karyawan (user → null). */
export async function unlinkEmployeeUser(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "hr.employees.manage");
  const run = async (tx: Tx) => {
    const current = await requireEmployee(tx, id);
    if (current.userId === null) return current;
    await tx.update(employees).set({ userId: null, updatedBy: actor.userId, updatedAt: new Date() }).where(eq(employees.id, id));
    await audit.log({ action: "hr.employee.unlink_user", entityType: "employee", entityId: id, actorId: actor.userId, before: { userId: current.userId } }, tx);
    return requireEmployee(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}
