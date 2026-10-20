import { eq } from "drizzle-orm";

import { jobRuns } from "@/db/schema";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { forbidden, notFound } from "@/server/errors";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Reader = Tx | typeof db;

/** Guard izin seragam untuk job ekspor & dashboard. */
export function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

/** Jalankan `fn` dalam transaksi baru, atau reuse `externalTx` (pola uji rollback). */
export async function inTx<T>(externalTx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (externalTx) return fn(externalTx);
  return db.transaction(fn);
}

/** Muat baris job; tidak ditemukan -> 404. */
export async function requireJob(reader: Reader, id: string) {
  const [row] = await reader.select().from(jobRuns).where(eq(jobRuns.id, id)).limit(1);
  if (!row) throw notFound("Job tidak ditemukan.");
  return row;
}

/**
 * Muat job + paksa kepemilikan (Tahap 10B — tutup IDOR artefak ekspor).
 * Akses hanya bila pembuat ATAU pemegang `reporting.exports.manage` (override admin).
 * Non-kreator tanpa manage -> 403. Pemanggil tetap wajib `assertCan(read)` lebih dulu.
 */
export async function requireJobForActor(reader: Reader, actor: AuthContext, id: string) {
  const job = await requireJob(reader, id);
  if (job.createdBy === actor.userId) return job;
  if (can(actor.grants, "reporting.exports.manage")) return job;
  throw forbidden();
}

/** Kunci baris job FOR UPDATE — transisi state (claim/cancel) harus serial. */
export async function lockJob(tx: Tx, id: string) {
  const [row] = await tx
    .select()
    .from(jobRuns)
    .where(eq(jobRuns.id, id))
    .for("update")
    .limit(1);
  if (!row) throw notFound("Job tidak ditemukan.");
  return row;
}
