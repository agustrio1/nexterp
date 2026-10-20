import { eq, isNull, lte, or, sql } from "drizzle-orm";

import { users } from "@/db/schema";
import { db } from "@/server/db";

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

export type LoginGate = "allowed" | "locked" | "blocked";

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Pemeriksaan sebelum Better Auth memverifikasi password.
 * - "blocked": akun tidak aktif (suspended)
 * - "locked": akun sedang dikunci karena terlalu banyak kegagalan
 * - "allowed": lanjutkan (termasuk email yang tidak terdaftar, supaya ditolak dengan pesan generik)
 */
export async function checkLoginGate(email: string): Promise<LoginGate> {
  const [user] = await db
    .select({ status: users.status, lockedUntil: users.lockedUntil })
    .from(users)
    .where(eq(users.email, normalize(email)))
    .limit(1);

  if (!user) return "allowed";
  if (user.status !== "active") return "blocked";
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) return "locked";
  return "allowed";
}

/**
 * Menambah hitungan gagal secara atomik. Pada kegagalan ke-MAX, akun dikunci.
 * Tidak berefek bila akun sedang terkunci, agar percobaan saat terkunci tidak memperpanjang kunci.
 * Hitungan baru di-reset saat login berhasil.
 */
export async function recordLoginFailure(email: string): Promise<void> {
  await db
    .update(users)
    .set({
      failedLoginCount: sql`${users.failedLoginCount} + 1`,
      lockedUntil: sql`case when ${users.failedLoginCount} + 1 >= ${MAX_FAILED_LOGINS}
        then now() + (${LOCKOUT_MINUTES} * interval '1 minute')
        else ${users.lockedUntil} end`,
    })
    .where(
      sql`${eq(users.email, normalize(email))} and ${or(isNull(users.lockedUntil), lte(users.lockedUntil, sql`now()`))}`,
    );
}

export async function recordLoginSuccess(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(eq(users.id, userId));
}