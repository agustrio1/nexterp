import { and, asc, eq, gte, lte, sql } from "drizzle-orm";

import {
  attendanceLogs,
  departments,
  employees,
  leaveBalances,
  leaveTypes,
} from "@/db/schema";
import type {
  AttendanceSummaryQuery,
  HeadcountQuery,
  LeaveBalancesQuery,
} from "@/modules/hr/report-schemas";
import { assertCan } from "@/modules/hr/_refs";
import { sub, toDb } from "@/lib/money";
import type { AuthContext } from "@/server/authz";
import { db } from "@/server/db";

/**
 * Laporan HR (Tahap 7F), read-only: headcount per departemen, rekap absensi,
 * dan saldo cuti. Tidak menyentuh remunerasi — cukup izin `hr.reports.read`.
 * Days (saldo cuti) memakai string desimal lewat money.ts; hitungan cacah
 * (absensi/headcount) berupa integer.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const DAY_DP = 2;

/* --------------------- Headcount per departemen -------------------- */

export async function headcountByDepartment(
  actor: AuthContext,
  query: HeadcountQuery,
  externalTx?: Tx,
) {
  assertCan(actor, "hr.reports.read");
  const reader = externalTx ?? db;

  const rows = await reader
    .select({
      departmentId: employees.departmentId,
      departmentCode: departments.code,
      departmentName: departments.name,
      employeeCount: sql<number>`count(*)::int`,
    })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(
      and(
        eq(employees.isActive, true),
        query.branchId === undefined ? undefined : eq(employees.branchId, query.branchId),
      ),
    )
    .groupBy(employees.departmentId, departments.code, departments.name)
    .orderBy(asc(departments.code));

  const result = rows.map((r) => ({
    departmentId: r.departmentId,
    departmentCode: r.departmentCode,
    departmentName: r.departmentName,
    employeeCount: r.employeeCount,
  }));

  return {
    branchId: query.branchId ?? null,
    totalHeadcount: result.reduce((a, r) => a + r.employeeCount, 0),
    rows: result,
  };
}

/* ------------------------- Rekap absensi --------------------------- */

export async function attendanceSummary(
  actor: AuthContext,
  query: AttendanceSummaryQuery,
  externalTx?: Tx,
) {
  assertCan(actor, "hr.reports.read");
  const reader = externalTx ?? db;

  const where = and(
    query.from === undefined ? undefined : gte(attendanceLogs.workDate, query.from),
    query.to === undefined ? undefined : lte(attendanceLogs.workDate, query.to),
    query.departmentId === undefined ? undefined : eq(employees.departmentId, query.departmentId),
    query.branchId === undefined ? undefined : eq(employees.branchId, query.branchId),
  );

  const rows = await reader
    .select({
      status: attendanceLogs.status,
      records: sql<number>`count(*)::int`,
      employees: sql<number>`count(distinct ${attendanceLogs.employeeId})::int`,
      overtimeMinutes: sql<number>`coalesce(sum(${attendanceLogs.overtimeMinutes}), 0)::int`,
    })
    .from(attendanceLogs)
    .innerJoin(employees, eq(employees.id, attendanceLogs.employeeId))
    .where(where)
    .groupBy(attendanceLogs.status)
    .orderBy(asc(attendanceLogs.status));

  const result = rows.map((r) => ({
    status: r.status,
    records: r.records,
    employees: r.employees,
    overtimeMinutes: r.overtimeMinutes,
  }));

  return {
    from: query.from ?? null,
    to: query.to ?? null,
    departmentId: query.departmentId ?? null,
    branchId: query.branchId ?? null,
    totals: {
      records: result.reduce((a, r) => a + r.records, 0),
      overtimeMinutes: result.reduce((a, r) => a + r.overtimeMinutes, 0),
    },
    rows: result,
  };
}

/* --------------------------- Saldo cuti ---------------------------- */

export async function leaveBalancesReport(
  actor: AuthContext,
  query: LeaveBalancesQuery,
  externalTx?: Tx,
) {
  assertCan(actor, "hr.reports.read");
  const reader = externalTx ?? db;
  const year = query.year ?? new Date().getFullYear();

  const rows = await reader
    .select({
      employeeId: employees.id,
      employeeCode: employees.code,
      employeeName: sql<string>`trim(coalesce(${employees.firstName}, '') || ' ' || coalesce(${employees.lastName}, ''))`,
      departmentId: employees.departmentId,
      leaveTypeId: leaveTypes.id,
      leaveTypeCode: leaveTypes.code,
      leaveTypeName: leaveTypes.name,
      paid: leaveTypes.paid,
      year: leaveBalances.year,
      totalDays: leaveBalances.totalDays,
      usedDays: leaveBalances.usedDays,
    })
    .from(leaveBalances)
    .innerJoin(employees, eq(employees.id, leaveBalances.employeeId))
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveBalances.leaveTypeId))
    .where(
      and(
        eq(leaveBalances.year, year),
        query.departmentId === undefined ? undefined : eq(employees.departmentId, query.departmentId),
      ),
    )
    .orderBy(asc(employees.code), asc(leaveTypes.code));

  const result = rows.map((r) => ({
    employeeId: r.employeeId,
    employeeCode: r.employeeCode,
    employeeName: r.employeeName,
    departmentId: r.departmentId,
    leaveTypeId: r.leaveTypeId,
    leaveTypeCode: r.leaveTypeCode,
    leaveTypeName: r.leaveTypeName,
    paid: r.paid,
    year: r.year,
    totalDays: toDb(r.totalDays, DAY_DP),
    usedDays: toDb(r.usedDays, DAY_DP),
    remainingDays: toDb(sub(r.totalDays, r.usedDays), DAY_DP),
  }));

  return {
    year,
    departmentId: query.departmentId ?? null,
    totalRemaining: toDb(
      result.reduce((a, r) => a.plus(sub(r.totalDays, r.usedDays)), sub("0", "0")),
      DAY_DP,
    ),
    rows: result,
  };
}
