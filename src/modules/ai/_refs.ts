import { eq } from "drizzle-orm";

import { aiSettings } from "@/db/schema";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { forbidden, notFound } from "@/server/errors";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Reader = Tx | typeof db;

/** Id baris konfigurasi AI tunggal (dibuat seed; layanan tak pernah menambah baris lain). */
export const AI_SETTINGS_ID = "00000000-0000-0000-0000-0000000000a9";

/** Guard izin seragam untuk modul AI. */
export function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

/** Jalankan `fn` dalam transaksi baru, atau reuse `externalTx` (pola uji rollback). */
export async function inTx<T>(externalTx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (externalTx) return fn(externalTx);
  return db.transaction(fn);
}

/** Muat baris konfigurasi AI; hilang = belum pernah seed (404). */
export async function requireSettingsRow(reader: Reader) {
  const [row] = await reader.select().from(aiSettings).where(eq(aiSettings.id, AI_SETTINGS_ID)).limit(1);
  if (!row) throw notFound("Konfigurasi AI belum tersedia (jalankan seed).");
  return row;
}
