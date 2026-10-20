import { eq } from "drizzle-orm";

import {
  payrollPeriods,
  payrollRuns,
  salaryComponents,
  salaryStructures,
  statutoryRules,
} from "@/db/schema";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { conflict, forbidden, notFound } from "@/server/errors";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Reader = Tx | typeof db;

/** Guard izin seragam untuk seluruh service payroll. */
export function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

/** Jalankan `fn` dalam transaksi baru, atau reuse `externalTx` (pola uji rollback). */
export async function inTx<T>(externalTx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (externalTx) return fn(externalTx);
  return db.transaction(fn);
}

export async function requireStructure(reader: Reader, id: string) {
  const [row] = await reader
    .select()
    .from(salaryStructures)
    .where(eq(salaryStructures.id, id))
    .limit(1);
  if (!row) throw notFound("Struktur gaji tidak ditemukan.");
  return row;
}

export async function requireActiveComponent(reader: Reader, id: string, path = "componentId") {
  const [row] = await reader
    .select()
    .from(salaryComponents)
    .where(eq(salaryComponents.id, id))
    .limit(1);
  if (!row) throw notFound(`Komponen gaji (${path}) tidak ditemukan.`);
  if (!row.isActive) throw conflict(`Komponen ${row.code} tidak aktif.`);
  return row;
}

export async function requireRule(reader: Reader, id: string) {
  const [row] = await reader.select().from(statutoryRules).where(eq(statutoryRules.id, id)).limit(1);
  if (!row) throw notFound("Aturan statutory tidak ditemukan.");
  return row;
}

export async function requirePeriod(reader: Reader, id: string) {
  const [row] = await reader.select().from(payrollPeriods).where(eq(payrollPeriods.id, id)).limit(1);
  if (!row) throw notFound("Periode payroll tidak ditemukan.");
  return row;
}

export async function requireRun(reader: Reader, id: string) {
  const [row] = await reader.select().from(payrollRuns).where(eq(payrollRuns.id, id)).limit(1);
  if (!row) throw notFound("Run payroll tidak ditemukan.");
  return row;
}

/** Kunci run FOR UPDATE untuk transisi status (calculate/approve/post/cancel/reverse). */
export async function lockRun(tx: Tx, id: string) {
  const [row] = await tx
    .select()
    .from(payrollRuns)
    .where(eq(payrollRuns.id, id))
    .for("update")
    .limit(1);
  if (!row) throw notFound("Run payroll tidak ditemukan.");
  return row;
}
