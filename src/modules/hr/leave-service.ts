import { and, asc, eq } from "drizzle-orm";

import { leaveBalances, leaveRequests, leaveTypes } from "@/db/schema";
import type {
  CreateLeaveBalanceInput,
  CreateLeaveRequestInput,
  CreateLeaveTypeInput,
  DecideRequestInput,
  UpdateLeaveTypeInput,
} from "@/modules/hr/schemas";
import { assertCan, requireActiveEmployee, assertActiveLeaveType } from "@/modules/hr/_refs";
import { add, cmp, sub, toDb } from "@/lib/money";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { businessRule, conflict, notFound, validationFailed } from "@/server/errors";
import { nextDocumentNumber } from "@/server/numbering";
import type { AuthContext } from "@/server/authz";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Tx | typeof db;

const DAYS_DP = 2;

const typeColumns = {
  id: leaveTypes.id,
  code: leaveTypes.code,
  name: leaveTypes.name,
  paid: leaveTypes.paid,
  defaultQuotaDays: leaveTypes.defaultQuotaDays,
  requiresApproval: leaveTypes.requiresApproval,
  isActive: leaveTypes.isActive,
};

const balanceColumns = {
  id: leaveBalances.id,
  employeeId: leaveBalances.employeeId,
  leaveTypeId: leaveBalances.leaveTypeId,
  year: leaveBalances.year,
  totalDays: leaveBalances.totalDays,
  usedDays: leaveBalances.usedDays,
};

const requestColumns = {
  id: leaveRequests.id,
  docNo: leaveRequests.docNo,
  employeeId: leaveRequests.employeeId,
  leaveTypeId: leaveRequests.leaveTypeId,
  startDate: leaveRequests.startDate,
  endDate: leaveRequests.endDate,
  days: leaveRequests.days,
  status: leaveRequests.status,
  reason: leaveRequests.reason,
  approverId: leaveRequests.approverId,
  createdAt: leaveRequests.createdAt,
  updatedAt: leaveRequests.updatedAt,
};

async function requireLeaveType(reader: Reader, id: string) {
  const [row] = await reader.select(typeColumns).from(leaveTypes).where(eq(leaveTypes.id, id)).limit(1);
  if (!row) throw notFound("Jenis cuti tidak ditemukan.");
  return row;
}

async function requireRequest(reader: Reader, id: string) {
  const [row] = await reader.select(requestColumns).from(leaveRequests).where(eq(leaveRequests.id, id)).limit(1);
  if (!row) throw notFound("Pengajuan cuti tidak ditemukan.");
  return row;
}

/* ----------------------------- Jenis cuti ----------------------------- */

export async function listLeaveTypes(actor: AuthContext, externalTx?: Tx) {
  assertCan(actor, "hr.leaves.read");
  return (externalTx ?? db).select(typeColumns).from(leaveTypes).orderBy(asc(leaveTypes.code));
}

export async function createLeaveType(actor: AuthContext, input: CreateLeaveTypeInput, externalTx?: Tx) {
  assertCan(actor, "hr.leaves.manage");
  const run = async (tx: Tx) => {
    const [existing] = await tx.select({ id: leaveTypes.id }).from(leaveTypes).where(eq(leaveTypes.code, input.code)).limit(1);
    if (existing) throw conflict("Kode jenis cuti sudah dipakai.");
    const values = {
      code: input.code,
      name: input.name,
      paid: input.paid ?? true,
      defaultQuotaDays: input.defaultQuotaDays ?? null,
      requiresApproval: input.requiresApproval ?? true,
    };
    const [created] = await tx
      .insert(leaveTypes)
      .values({ ...values, isActive: true, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: leaveTypes.id });
    if (!created) throw new Error("Gagal membuat jenis cuti.");
    await audit.log({ action: "hr.leave_type.create", entityType: "leave_type", entityId: created.id, actorId: actor.userId, after: values }, tx);
    return requireLeaveType(tx, created.id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function updateLeaveType(actor: AuthContext, id: string, input: UpdateLeaveTypeInput, externalTx?: Tx) {
  assertCan(actor, "hr.leaves.manage");
  const run = async (tx: Tx) => {
    const current = await requireLeaveType(tx, id);
    const next = {
      name: input.name ?? current.name,
      paid: input.paid ?? current.paid,
      defaultQuotaDays: input.defaultQuotaDays === undefined ? current.defaultQuotaDays : input.defaultQuotaDays,
      requiresApproval: input.requiresApproval ?? current.requiresApproval,
      isActive: input.isActive ?? current.isActive,
    };
    await tx.update(leaveTypes).set({ ...next, updatedBy: actor.userId, updatedAt: new Date() }).where(eq(leaveTypes.id, id));
    await audit.log({ action: "hr.leave_type.update", entityType: "leave_type", entityId: id, actorId: actor.userId, after: next }, tx);
    return requireLeaveType(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

/* ----------------------------- Saldo cuti ----------------------------- */

export async function listLeaveBalances(actor: AuthContext, employeeId: string | undefined, externalTx?: Tx) {
  assertCan(actor, "hr.leaves.read");
  const reader = externalTx ?? db;
  const base = reader.select(balanceColumns).from(leaveBalances);
  const q = employeeId ? base.where(eq(leaveBalances.employeeId, employeeId)) : base;
  return q.orderBy(asc(leaveBalances.year));
}

/** Buat atau timpa kuota saldo cuti (totalDays) per karyawan/jenis/tahun. */
export async function setLeaveBalance(actor: AuthContext, input: CreateLeaveBalanceInput, externalTx?: Tx) {
  assertCan(actor, "hr.leaves.manage");
  const run = async (tx: Tx) => {
    await requireActiveEmployee(tx, input.employeeId);
    await assertActiveLeaveType(tx, input.leaveTypeId);
    const totalDays = toDb(input.totalDays, DAYS_DP);
    const [row] = await tx
      .insert(leaveBalances)
      .values({
        employeeId: input.employeeId,
        leaveTypeId: input.leaveTypeId,
        year: input.year,
        totalDays,
        usedDays: "0.00",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .onConflictDoUpdate({
        target: [leaveBalances.employeeId, leaveBalances.leaveTypeId, leaveBalances.year],
        set: { totalDays, updatedBy: actor.userId, updatedAt: new Date() },
      })
      .returning({ id: leaveBalances.id });
    if (!row) throw new Error("Gagal menyimpan saldo cuti.");
    await audit.log({ action: "hr.leave_balance.set", entityType: "leave_balance", entityId: row.id, actorId: actor.userId, after: { totalDays, year: input.year } }, tx);
    return row.id;
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

/* ----------------------------- Pengajuan cuti ----------------------------- */

export async function listLeaveRequests(actor: AuthContext, employeeId: string | undefined, externalTx?: Tx) {
  assertCan(actor, "hr.leaves.read");
  const reader = externalTx ?? db;
  const base = reader.select(requestColumns).from(leaveRequests);
  const q = employeeId ? base.where(eq(leaveRequests.employeeId, employeeId)) : base;
  return q.orderBy(asc(leaveRequests.startDate));
}

export async function getLeaveRequest(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "hr.leaves.read");
  return requireRequest(externalTx ?? db, id);
}

export async function createLeaveRequest(actor: AuthContext, input: CreateLeaveRequestInput, externalTx?: Tx) {
  assertCan(actor, "hr.leaves.manage");
  const run = async (tx: Tx) => {
    if (input.endDate < input.startDate) {
      throw validationFailed([{ path: "endDate", message: "Tanggal selesai tidak boleh sebelum tanggal mulai." }]);
    }
    await requireActiveEmployee(tx, input.employeeId);
    await assertActiveLeaveType(tx, input.leaveTypeId);

    const docNo = await nextDocumentNumber(tx, "leave_request", { date: input.startDate });
    const values = {
      docNo,
      employeeId: input.employeeId,
      leaveTypeId: input.leaveTypeId,
      startDate: input.startDate,
      endDate: input.endDate,
      days: toDb(input.days, DAYS_DP),
      status: "draft" as const,
      reason: input.reason ?? null,
      approverId: null,
    };
    const [created] = await tx
      .insert(leaveRequests)
      .values({ ...values, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: leaveRequests.id });
    if (!created) throw new Error("Gagal membuat pengajuan cuti.");
    await audit.log({ action: "hr.leave_request.create", entityType: "leave_request", entityId: created.id, actorId: actor.userId, after: { docNo, days: values.days } }, tx);
    return requireRequest(tx, created.id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

/** draft -> pending. */
export async function submitLeaveRequest(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "hr.leaves.manage");
  const run = async (tx: Tx) => {
    const req = await requireRequest(tx, id);
    if (req.status !== "draft") throw businessRule("Hanya pengajuan berstatus draf dapat dikirim.");
    await tx.update(leaveRequests).set({ status: "pending", updatedBy: actor.userId, updatedAt: new Date() }).where(eq(leaveRequests.id, id));
    await audit.log({ action: "hr.leave_request.submit", entityType: "leave_request", entityId: id, actorId: actor.userId }, tx);
    return requireRequest(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

/** pending -> approved; potong saldo cuti tahun mulai. */
export async function approveLeaveRequest(actor: AuthContext, id: string, input: DecideRequestInput, externalTx?: Tx) {
  assertCan(actor, "hr.leaves.manage");
  const run = async (tx: Tx) => {
    const req = await requireRequest(tx, id);
    if (req.status !== "pending") throw businessRule("Hanya pengajuan berstatus pending dapat disetujui.");

    const year = Number(req.startDate.slice(0, 4));
    const [balance] = await tx
      .select(balanceColumns)
      .from(leaveBalances)
      .where(and(eq(leaveBalances.employeeId, req.employeeId), eq(leaveBalances.leaveTypeId, req.leaveTypeId), eq(leaveBalances.year, year)))
      .limit(1);
    if (!balance) throw businessRule(`Saldo cuti tahun ${year} belum tersedia untuk karyawan ini.`);

    const remaining = sub(balance.totalDays, balance.usedDays);
    if (cmp(remaining, req.days) < 0) throw businessRule("Saldo cuti tidak mencukupi untuk pengajuan ini.");

    const usedDays = toDb(add(balance.usedDays, req.days), DAYS_DP);
    await tx.update(leaveBalances).set({ usedDays, updatedBy: actor.userId, updatedAt: new Date() }).where(eq(leaveBalances.id, balance.id));
    await tx
      .update(leaveRequests)
      .set({ status: "approved", approverId: input.approverId ?? actor.userId, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(leaveRequests.id, id));

    await audit.log({ action: "hr.leave_request.approve", entityType: "leave_request", entityId: id, actorId: actor.userId, after: { usedDays } }, tx);
    return requireRequest(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

/** pending -> rejected. */
export async function rejectLeaveRequest(actor: AuthContext, id: string, input: DecideRequestInput, externalTx?: Tx) {
  assertCan(actor, "hr.leaves.manage");
  const run = async (tx: Tx) => {
    const req = await requireRequest(tx, id);
    if (req.status !== "pending") throw businessRule("Hanya pengajuan berstatus pending dapat ditolak.");
    await tx.update(leaveRequests).set({ status: "rejected", approverId: input.approverId ?? actor.userId, updatedBy: actor.userId, updatedAt: new Date() }).where(eq(leaveRequests.id, id));
    await audit.log({ action: "hr.leave_request.reject", entityType: "leave_request", entityId: id, actorId: actor.userId }, tx);
    return requireRequest(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

/** draft/pending -> cancelled. */
export async function cancelLeaveRequest(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "hr.leaves.manage");
  const run = async (tx: Tx) => {
    const req = await requireRequest(tx, id);
    if (req.status !== "draft" && req.status !== "pending") throw businessRule("Hanya pengajuan draf/pending dapat dibatalkan.");
    await tx.update(leaveRequests).set({ status: "cancelled", updatedBy: actor.userId, updatedAt: new Date() }).where(eq(leaveRequests.id, id));
    await audit.log({ action: "hr.leave_request.cancel", entityType: "leave_request", entityId: id, actorId: actor.userId }, tx);
    return requireRequest(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}
