import { eq } from "drizzle-orm";

import {
  accountingPeriods,
  assetAcquisitions,
  assetCategories,
  assetDepreciationRuns,
  assetDisposals,
  assetRevaluations,
  fixedAssets,
} from "@/db/schema";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { conflict, forbidden, notFound } from "@/server/errors";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Reader = Tx | typeof db;

/** Guard izin seragam untuk seluruh service aset. */
export function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

/** Jalankan `fn` dalam transaksi baru, atau reuse `externalTx` (pola uji rollback). */
export async function inTx<T>(externalTx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (externalTx) return fn(externalTx);
  return db.transaction(fn);
}

export async function requireCategory(reader: Reader, id: string) {
  const [row] = await reader
    .select()
    .from(assetCategories)
    .where(eq(assetCategories.id, id))
    .limit(1);
  if (!row) throw notFound("Kategori aset tidak ditemukan.");
  return row;
}

export async function requireActiveCategory(reader: Reader, id: string) {
  const row = await requireCategory(reader, id);
  if (!row.isActive) throw conflict(`Kategori aset ${row.code} tidak aktif.`);
  return row;
}

export async function requireAsset(reader: Reader, id: string) {
  const [row] = await reader.select().from(fixedAssets).where(eq(fixedAssets.id, id)).limit(1);
  if (!row) throw notFound("Aset tetap tidak ditemukan.");
  return row;
}

/** Asset yang masih dapat diakuisisi/disusutkan (belum dilepas). */
export async function requireLiveAsset(reader: Reader, id: string) {
  const row = await requireAsset(reader, id);
  if (row.status === "disposed") throw conflict("Aset sudah dilepas; tidak dapat diubah.");
  return row;
}

export async function requireAcquisition(reader: Reader, id: string) {
  const [row] = await reader
    .select()
    .from(assetAcquisitions)
    .where(eq(assetAcquisitions.id, id))
    .limit(1);
  if (!row) throw notFound("Akuisisi aset tidak ditemukan.");
  return row;
}

export async function lockAcquisition(tx: Tx, id: string) {
  const [row] = await tx
    .select()
    .from(assetAcquisitions)
    .where(eq(assetAcquisitions.id, id))
    .for("update")
    .limit(1);
  if (!row) throw notFound("Akuisisi aset tidak ditemukan.");
  return row;
}

export async function requireRun(reader: Reader, id: string) {
  const [row] = await reader
    .select()
    .from(assetDepreciationRuns)
    .where(eq(assetDepreciationRuns.id, id))
    .limit(1);
  if (!row) throw notFound("Run penyusutan tidak ditemukan.");
  return row;
}

/** Kunci run FOR UPDATE untuk transisi status (calculate/approve/post/cancel/reverse). */
export async function lockRun(tx: Tx, id: string) {
  const [row] = await tx
    .select()
    .from(assetDepreciationRuns)
    .where(eq(assetDepreciationRuns.id, id))
    .for("update")
    .limit(1);
  if (!row) throw notFound("Run penyusutan tidak ditemukan.");
  return row;
}

export async function lockDisposal(tx: Tx, id: string) {
  const [row] = await tx
    .select()
    .from(assetDisposals)
    .where(eq(assetDisposals.id, id))
    .for("update")
    .limit(1);
  if (!row) throw notFound("Pelepasan aset tidak ditemukan.");
  return row;
}

export async function lockRevaluation(tx: Tx, id: string) {
  const [row] = await tx
    .select()
    .from(assetRevaluations)
    .where(eq(assetRevaluations.id, id))
    .for("update")
    .limit(1);
  if (!row) throw notFound("Revaluasi aset tidak ditemukan.");
  return row;
}

/**
 * Periode akuntansi yang dipakai run penyusutan: wajib ada. `endDate` menjadi
 * tanggal jurnal; `startDate` menentukan kunci periode (YYYY-MM) untuk jadwal & usage.
 */
export async function requireAccountingPeriod(reader: Reader, id: string) {
  const [row] = await reader
    .select()
    .from(accountingPeriods)
    .where(eq(accountingPeriods.id, id))
    .limit(1);
  if (!row) throw notFound("Periode akuntansi tidak ditemukan.");
  return row;
}

/** Kunci periode (YYYY-MM) dari tanggal; dipakai periodKey jadwal & usage. */
export function periodKeyOf(date: string): string {
  return date.slice(0, 7);
}
