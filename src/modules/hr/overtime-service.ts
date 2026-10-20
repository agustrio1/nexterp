import { asc, eq } from "drizzle-orm";

import { overtimeRequests } from "@/db/schema";
import type { CreateOvertimeInput, DecideRequestInput } from "@/modules/hr/schemas";
import { assertCan, requireActiveEmployee } from "@/modules/hr/_refs";
import { toDb } from "@/lib/money";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { businessRule, notFound, validationFailed } from "@/server/errors";
import { nextDocumentNumber } from "@/server/numbering";
import type { AuthContext } from "@/server/authz";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const columns = {
  id: overtimeRequests.id,
  docNo: overtimeRequests.docNo,
  employeeId: overtimeRequests.employeeId,
  workDate: overtimeRequests.workDate,
  startAt: overtimeRequests.startAt,
  endAt: overtimeRequests.endAt,
  hours: overtimeRequests.hours,
  status: overtimeRequests.status,
  reason: overtimeRequests.reason,
  approverId: overtimeRequests.approverId,
  createdAt: overtimeRequests.createdAt,
  updatedAt: overtimeRequests.updatedAt,
};

async function requireOvertime(reader: Tx | typeof db, id: string) {
  const [row] = await reader.select(columns).from(overtimeRequests).where(eq(overtimeRequests.id, id)).limit(1);
  if (!row) throw notFound("Pengajuan lembur tidak ditemukan.");
  return row;
}

export async function listOvertime(actor: AuthContext, employeeId: string | undefined, externalTx?: Tx) {
  assertCan(actor, "hr.overtime.read");
  const reader = externalTx ?? db;
  const base = reader.select(columns).from(overtimeRequests);
  const q = employeeId ? base.where(eq(overtimeRequests.employeeId, employeeId)) : base;
  return q.orderBy(asc(overtimeRequests.workDate));
}

export async function createOvertime(actor: AuthContext, input: CreateOvertimeInput, externalTx?: Tx) {
  assertCan(actor, "hr.overtime.manage");
  const run = async (tx: Tx) => {
    if (new Date(input.endAt).getTime() <= new Date(input.startAt).getTime()) {
      throw validationFailed([{ path: "endAt", message: "Waktu selesai harus setelah waktu mulai." }]);
    }
    await requireActiveEmployee(tx, input.employeeId);

    const docNo = await nextDocumentNumber(tx, "overtime_request", { date: input.workDate });
    const values = {
      docNo,
      employeeId: input.employeeId,
      workDate: input.workDate,
      startAt: new Date(input.startAt),
      endAt: new Date(input.endAt),
      hours: toDb(input.hours, 2),
      status: "draft" as const,
      reason: input.reason ?? null,
      approverId: null,
    };
    const [created] = await tx
      .insert(overtimeRequests)
      .values({ ...values, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: overtimeRequests.id });
    if (!created) throw new Error("Gagal membuat pengajuan lembur.");
    await audit.log({ action: "hr.overtime.create", entityType: "overtime_request", entityId: created.id, actorId: actor.userId, after: { docNo, hours: values.hours } }, tx);
    return requireOvertime(tx, created.id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function submitOvertime(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "hr.overtime.manage");
  const run = async (tx: Tx) => {
    const req = await requireOvertime(tx, id);
    if (req.status !== "draft") throw businessRule("Hanya pengajuan lembur draf dapat dikirim.");
    await tx.update(overtimeRequests).set({ status: "pending", updatedBy: actor.userId, updatedAt: new Date() }).where(eq(overtimeRequests.id, id));
    await audit.log({ action: "hr.overtime.submit", entityType: "overtime_request", entityId: id, actorId: actor.userId }, tx);
    return requireOvertime(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function approveOvertime(actor: AuthContext, id: string, input: DecideRequestInput, externalTx?: Tx) {
  assertCan(actor, "hr.overtime.manage");
  const run = async (tx: Tx) => {
    const req = await requireOvertime(tx, id);
    if (req.status !== "pending") throw businessRule("Hanya pengajuan lembur pending dapat disetujui.");
    await tx.update(overtimeRequests).set({ status: "approved", approverId: input.approverId ?? actor.userId, updatedBy: actor.userId, updatedAt: new Date() }).where(eq(overtimeRequests.id, id));
    await audit.log({ action: "hr.overtime.approve", entityType: "overtime_request", entityId: id, actorId: actor.userId }, tx);
    return requireOvertime(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function rejectOvertime(actor: AuthContext, id: string, input: DecideRequestInput, externalTx?: Tx) {
  assertCan(actor, "hr.overtime.manage");
  const run = async (tx: Tx) => {
    const req = await requireOvertime(tx, id);
    if (req.status !== "pending") throw businessRule("Hanya pengajuan lembur pending dapat ditolak.");
    await tx.update(overtimeRequests).set({ status: "rejected", approverId: input.approverId ?? actor.userId, updatedBy: actor.userId, updatedAt: new Date() }).where(eq(overtimeRequests.id, id));
    await audit.log({ action: "hr.overtime.reject", entityType: "overtime_request", entityId: id, actorId: actor.userId }, tx);
    return requireOvertime(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}
