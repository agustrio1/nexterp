import { eq } from "drizzle-orm";

import { costCenters, employees, projects } from "@/db/schema";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { conflict, forbidden, notFound } from "@/server/errors";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Reader = Tx | typeof db;

/** Guard izin seragam untuk seluruh service proyek. */
export function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

/** Jalankan `fn` dalam transaksi baru, atau reuse `externalTx` (pola uji rollback). */
export async function inTx<T>(externalTx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (externalTx) return fn(externalTx);
  return db.transaction(fn);
}

export async function requireProject(reader: Reader, id: string) {
  const [row] = await reader
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!row) throw notFound("Proyek tidak ditemukan.");
  return row;
}

/** Kunci proyek FOR UPDATE untuk transisi state/penautan cost center. */
export async function lockProject(tx: Tx, id: string) {
  const [row] = await tx
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .for("update")
    .limit(1);
  if (!row) throw notFound("Proyek tidak ditemukan.");
  return row;
}

/** Cost center aktif dan belum ditautkan proyek lain (guard 1:1). */
export async function requireLinkableCostCenter(tx: Tx, costCenterId: string, exceptProjectId?: string) {
  const [cc] = await tx
    .select({ id: costCenters.id, code: costCenters.code, name: costCenters.name, isActive: costCenters.isActive })
    .from(costCenters)
    .where(eq(costCenters.id, costCenterId))
    .limit(1);
  if (!cc) throw notFound("Pusat biaya tidak ditemukan.");
  if (!cc.isActive) throw conflict(`Pusat biaya ${cc.code} tidak aktif.`);
  const [linked] = await tx
    .select({ id: projects.id, code: projects.code })
    .from(projects)
    .where(eq(projects.costCenterId, costCenterId))
    .limit(1);
  if (linked && linked.id !== exceptProjectId) {
    throw conflict(`Pusat biaya ${cc.code} sudah ditautkan proyek ${linked.code}.`);
  }
  return cc;
}

export async function requireActiveEmployee(tx: Tx, id: string, label = "Karyawan") {
  const [row] = await tx
    .select({ id: employees.id, code: employees.code, isActive: employees.isActive })
    .from(employees)
    .where(eq(employees.id, id))
    .limit(1);
  if (!row) throw notFound(`${label} tidak ditemukan.`);
  if (!row.isActive) throw conflict(`${label} ${row.code} tidak aktif.`);
  return row;
}
