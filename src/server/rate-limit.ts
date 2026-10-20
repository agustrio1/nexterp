import { sql } from "drizzle-orm";

import { apiRateLimits } from "@/db/schema";
import { type DbExecutor } from "@/server/db";
import { rateLimited } from "@/server/errors";

/**
 * Rate-limit API lintas-instance berbasis Postgres (fixed window 1 menit).
 * Ditegakkan di `apiHandler` untuk metode tidak aman (POST/PUT/PATCH/DELETE).
 * Bucket: "api:<grup>:<ip-klien>" — grup = segmen path level-1 (mis. "journals").
 *
 * Prinsip:
 * - Satu statement upsert atomik agar aman antar-instance tanpa SELECT-then-UPDATE.
 * - Tidak ada data sensitif (IP) yang di-log atau dikirim ke klien.
 * - Baris jendela basi dibersihkan best-effort agar tabel tidak membengkak.
 *
 * Catatan siklus modul: `errors.ts` (apiHandler) mengimpor helper ini, sementara
 * helper mengimpor `rateLimited` dari `errors.ts`. Ini aman karena `rateLimited`
 * hanya dirujuk di dalam bodi fungsi (bukan saat evaluasi modul), sehingga TDZ
 * binding ESM selesai sebelum ada panggilan runtime.
 */

/** Batas permintaan tidak aman per bucket per menit (default global). */
export const API_UNSAFE_LIMIT_PER_MINUTE = 120;

/**
 * Naikkan counter satu bucket dengan jendela tetap atomik (1 menit).
 * Lempar `rateLimited()` (429) bila `count` melebihi `limit` setelah increment.
 * `now` dapat disuplai untuk uji deterministik; default `new Date()`.
 *
 * Bentuk SQL: `INSERT ... ON CONFLICT (key) DO UPDATE SET count = CASE ... END,
 * windowStart = CASE ... END RETURNING count`. Bandingkan `windowStart` tersimpan
 * dengan `now - interval '1 minute'`; bila lebih lama -> jendela baru, count := 1;
 * selain itu count := count + 1 (windowStart tetap).
 */
export async function enforceRateLimit(
  executor: DbExecutor,
  key: string,
  limit: number,
  now: Date = new Date(),
): Promise<void> {
  const windowStartIso = now.toISOString();
  const staleCutoffIso = new Date(now.getTime() - 5 * 60_000).toISOString();

  const [row] = await executor
    .insert(apiRateLimits)
    .values({ key, windowStart: now, count: 1 })
    .onConflictDoUpdate({
      target: apiRateLimits.key,
      set: {
        count: sql`case
          when ${apiRateLimits.windowStart} < ((${windowStartIso}::timestamptz) - interval '1 minute')
          then 1
          else ${apiRateLimits.count} + 1
        end`,
        windowStart: sql`case
          when ${apiRateLimits.windowStart} < ((${windowStartIso}::timestamptz) - interval '1 minute')
          then (${windowStartIso}::timestamptz)
          else ${apiRateLimits.windowStart}
        end`,
      },
    })
    .returning({ count: apiRateLimits.count });

  const count = row?.count ?? 1;
  if (count > limit) throw rateLimited();

  // Cleanup best-effort: hapus baris yang jendelanya sudah jauh lewat agar tabel kecil.
  // Dijalankan hanya saat reset jendela (count === 1) supaya tidak tiap request.
  // Kegagalan diabaikan — pembersihan bukan jalur kritis.
  if (count === 1) {
    try {
      await executor
        .delete(apiRateLimits)
        .where(sql`${apiRateLimits.windowStart} < (${staleCutoffIso}::timestamptz)`);
    } catch {
      // noop
    }
  }
}
