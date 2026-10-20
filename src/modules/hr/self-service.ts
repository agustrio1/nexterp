import { and, asc, eq, gte, lte } from "drizzle-orm";

import { attendanceLogs, leaveBalances, leaveRequests, overtimeRequests } from "@/db/schema";
import { assertCan, resolveOwnEmployee } from "@/modules/hr/_refs";
import { db } from "@/server/db";
import type { AuthContext } from "@/server/authz";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Tx | typeof db;

/**
 * Employee self-service: setiap fungsi hanya membaca data milik karyawan
 * yang tertaut pada pemakai sesi (via employees.userId). Tidak ada mutasi.
 */

export async function getMyProfile(actor: AuthContext, externalTx?: Tx) {
  assertCan(actor, "hr.self.view");
  return resolveOwnEmployee(externalTx ?? db, actor.userId);
}

export async function getMyAttendance(actor: AuthContext, range: { from?: string; to?: string } = {}, externalTx?: Tx) {
  assertCan(actor, "hr.self.view");
  const reader: Reader = externalTx ?? db;
  const employee = await resolveOwnEmployee(reader, actor.userId);
  const conditions = [
    eq(attendanceLogs.employeeId, employee.id),
    range.from === undefined ? undefined : gte(attendanceLogs.workDate, range.from),
    range.to === undefined ? undefined : lte(attendanceLogs.workDate, range.to),
  ];
  return reader
    .select({
      id: attendanceLogs.id,
      workDate: attendanceLogs.workDate,
      status: attendanceLogs.status,
      checkInAt: attendanceLogs.checkInAt,
      checkOutAt: attendanceLogs.checkOutAt,
      overtimeMinutes: attendanceLogs.overtimeMinutes,
    })
    .from(attendanceLogs)
    .where(and(...conditions))
    .orderBy(asc(attendanceLogs.workDate));
}

export async function getMyLeave(actor: AuthContext, externalTx?: Tx) {
  assertCan(actor, "hr.self.view");
  const reader: Reader = externalTx ?? db;
  const employee = await resolveOwnEmployee(reader, actor.userId);

  const balances = await reader
    .select({
      id: leaveBalances.id,
      leaveTypeId: leaveBalances.leaveTypeId,
      year: leaveBalances.year,
      totalDays: leaveBalances.totalDays,
      usedDays: leaveBalances.usedDays,
    })
    .from(leaveBalances)
    .where(eq(leaveBalances.employeeId, employee.id))
    .orderBy(asc(leaveBalances.year));

  const requests = await reader
    .select({
      id: leaveRequests.id,
      docNo: leaveRequests.docNo,
      leaveTypeId: leaveRequests.leaveTypeId,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
      days: leaveRequests.days,
      status: leaveRequests.status,
    })
    .from(leaveRequests)
    .where(eq(leaveRequests.employeeId, employee.id))
    .orderBy(asc(leaveRequests.startDate));

  return { balances, requests };
}

export async function getMyOvertime(actor: AuthContext, externalTx?: Tx) {
  assertCan(actor, "hr.self.view");
  const reader: Reader = externalTx ?? db;
  const employee = await resolveOwnEmployee(reader, actor.userId);
  return reader
    .select({
      id: overtimeRequests.id,
      docNo: overtimeRequests.docNo,
      workDate: overtimeRequests.workDate,
      hours: overtimeRequests.hours,
      status: overtimeRequests.status,
    })
    .from(overtimeRequests)
    .where(eq(overtimeRequests.employeeId, employee.id))
    .orderBy(asc(overtimeRequests.workDate));
}
