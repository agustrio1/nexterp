import { and, asc, eq, gte, lte, type SQL } from "drizzle-orm";

import { attendanceLogs } from "@/db/schema";
import type { ListAttendanceQuery, RecordAttendanceInput } from "@/modules/hr/schemas";
import { assertActiveShift, assertCan, requireActiveEmployee } from "@/modules/hr/_refs";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { notFound } from "@/server/errors";
import type { AuthContext } from "@/server/authz";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const columns = {
  id: attendanceLogs.id,
  employeeId: attendanceLogs.employeeId,
  workDate: attendanceLogs.workDate,
  shiftId: attendanceLogs.shiftId,
  checkInAt: attendanceLogs.checkInAt,
  checkOutAt: attendanceLogs.checkOutAt,
  status: attendanceLogs.status,
  overtimeMinutes: attendanceLogs.overtimeMinutes,
  notes: attendanceLogs.notes,
  createdAt: attendanceLogs.createdAt,
  updatedAt: attendanceLogs.updatedAt,
};

async function requireLog(reader: Tx | typeof db, id: string) {
  const [row] = await reader.select(columns).from(attendanceLogs).where(eq(attendanceLogs.id, id)).limit(1);
  if (!row) throw notFound("Catatan absensi tidak ditemukan.");
  return row;
}

export async function listAttendance(actor: AuthContext, query: ListAttendanceQuery = {}, externalTx?: Tx) {
  assertCan(actor, "hr.attendance.read");
  const reader = externalTx ?? db;
  const conditions: (SQL | undefined)[] = [
    query.employeeId === undefined ? undefined : eq(attendanceLogs.employeeId, query.employeeId),
    query.from === undefined ? undefined : gte(attendanceLogs.workDate, query.from),
    query.to === undefined ? undefined : lte(attendanceLogs.workDate, query.to),
  ];
  return reader.select(columns).from(attendanceLogs).where(and(...conditions)).orderBy(asc(attendanceLogs.workDate));
}

/** Catat/ubah absensi harian (upsert pada employee + tanggal). */
export async function recordAttendance(actor: AuthContext, input: RecordAttendanceInput, externalTx?: Tx) {
  assertCan(actor, "hr.attendance.manage");
  const run = async (tx: Tx) => {
    await requireActiveEmployee(tx, input.employeeId);
    const shiftId = input.shiftId ?? null;
    if (shiftId !== null) await assertActiveShift(tx, shiftId);

    const payload = {
      shiftId,
      checkInAt: input.checkInAt ? new Date(input.checkInAt) : null,
      checkOutAt: input.checkOutAt ? new Date(input.checkOutAt) : null,
      status: input.status ?? "present",
      overtimeMinutes: input.overtimeMinutes ?? 0,
      notes: input.notes ?? null,
    };

    const [row] = await tx
      .insert(attendanceLogs)
      .values({
        employeeId: input.employeeId,
        workDate: input.workDate,
        ...payload,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .onConflictDoUpdate({
        target: [attendanceLogs.employeeId, attendanceLogs.workDate],
        set: { ...payload, updatedBy: actor.userId, updatedAt: new Date() },
      })
      .returning({ id: attendanceLogs.id });
    if (!row) throw new Error("Gagal mencatat absensi.");

    await audit.log({ action: "hr.attendance.record", entityType: "attendance_log", entityId: row.id, actorId: actor.userId, after: { employeeId: input.employeeId, workDate: input.workDate, status: payload.status } }, tx);
    return requireLog(tx, row.id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}
