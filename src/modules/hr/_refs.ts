import { eq } from "drizzle-orm";

import {
  branches,
  departments,
  employees,
  leaveTypes,
  positions,
  shifts,
  users,
} from "@/db/schema";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { conflict, forbidden, notFound, validationFailed } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Tx | typeof db;

/** Guard izin seragam untuk seluruh service HR. */
export function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

/** Cabang harus aktif. */
export async function assertActiveBranch(tx: Tx, branchId: string, path = "branchId"): Promise<void> {
  const [row] = await tx
    .select({ id: branches.id, isActive: branches.isActive })
    .from(branches)
    .where(eq(branches.id, branchId))
    .for("share")
    .limit(1);
  if (!row) throw validationFailed([{ path, message: "Cabang tidak ditemukan." }]);
  if (!row.isActive) throw conflict("Cabang tidak aktif.");
}

/** Departemen harus ada & aktif. */
export async function assertActiveDepartment(
  tx: Tx,
  departmentId: string,
  path = "departmentId",
): Promise<void> {
  const [row] = await tx
    .select({ id: departments.id, isActive: departments.isActive })
    .from(departments)
    .where(eq(departments.id, departmentId))
    .for("share")
    .limit(1);
  if (!row) throw validationFailed([{ path, message: "Departemen tidak ditemukan." }]);
  if (!row.isActive) throw conflict("Departemen tidak aktif.");
}

/** Jabatan harus ada & aktif. */
export async function assertActivePosition(tx: Tx, positionId: string, path = "positionId"): Promise<void> {
  const [row] = await tx
    .select({ id: positions.id, isActive: positions.isActive })
    .from(positions)
    .where(eq(positions.id, positionId))
    .for("share")
    .limit(1);
  if (!row) throw validationFailed([{ path, message: "Jabatan tidak ditemukan." }]);
  if (!row.isActive) throw conflict("Jabatan tidak aktif.");
}

/** Shift harus ada & aktif. */
export async function assertActiveShift(tx: Tx, shiftId: string, path = "shiftId"): Promise<void> {
  const [row] = await tx
    .select({ id: shifts.id, isActive: shifts.isActive })
    .from(shifts)
    .where(eq(shifts.id, shiftId))
    .for("share")
    .limit(1);
  if (!row) throw validationFailed([{ path, message: "Shift tidak ditemukan." }]);
  if (!row.isActive) throw conflict("Shift tidak aktif.");
}

/** Jenis cuti harus ada & aktif. */
export async function assertActiveLeaveType(
  tx: Tx,
  leaveTypeId: string,
  path = "leaveTypeId",
): Promise<void> {
  const [row] = await tx
    .select({ id: leaveTypes.id, isActive: leaveTypes.isActive })
    .from(leaveTypes)
    .where(eq(leaveTypes.id, leaveTypeId))
    .for("share")
    .limit(1);
  if (!row) throw validationFailed([{ path, message: "Jenis cuti tidak ditemukan." }]);
  if (!row.isActive) throw conflict("Jenis cuti tidak aktif.");
}

/** Karyawan harus ada & aktif (dipakai dokumen/transaksi anak). */
export async function requireActiveEmployee(reader: Reader, employeeId: string, path = "employeeId") {
  const [row] = await reader
    .select({
      id: employees.id,
      code: employees.code,
      userId: employees.userId,
      status: employees.status,
      isActive: employees.isActive,
    })
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);
  if (!row) throw validationFailed([{ path, message: "Karyawan tidak ditemukan." }]);
  if (!row.isActive) throw conflict(`Karyawan ${row.code} tidak aktif.`);
  return row;
}

/** User login harus ada dan belum tertaut ke karyawan lain (satu user = satu karyawan). */
export async function assertUserLinkable(tx: Tx, userId: string, path = "userId"): Promise<void> {
  const [user] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw validationFailed([{ path, message: "Pengguna tidak ditemukan." }]);

  const [taken] = await tx
    .select({ id: employees.id })
    .from(employees)
    .where(eq(employees.userId, userId))
    .limit(1);
  if (taken) throw conflict("Pengguna sudah tertaut ke karyawan lain.");
}

/** Ambil karyawan milik pemakai sesi (self-service); 404 bila akun tidak ditautkan. */
export async function resolveOwnEmployee(reader: Reader, userId: string) {
  const [row] = await reader
    .select({
      id: employees.id,
      code: employees.code,
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
    })
    .from(employees)
    .where(eq(employees.userId, userId))
    .limit(1);
  if (!row) throw notFound("Akun Anda belum ditautkan ke data karyawan.");
  return row;
}
