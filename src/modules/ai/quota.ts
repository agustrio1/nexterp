import { and, eq, gte, inArray, sql } from "drizzle-orm";

import { aiRequests } from "@/db/schema";
import { rateLimited } from "@/server/errors";

import type { Reader } from "./_refs";

/* ------------------------------------------------------------------ */
/* Kuota & rate limit sisi aplikasi (Tahap 9B).                        */
/* Best-effort di SAMPING batas project Google: mencegah satu pengguna   */
/* membakar kuota free tier yang ketat. Yang dihitung hanya baris yang   */
/* benar-benar memanggil provider (status ok/error) — penolakan          */
/* (rate_limited/disabled/validation) tidak dihitung, agar tidak         */
/* mengunci pengguna setelah satu penolakan.                             */
/* ------------------------------------------------------------------ */

export type AiLimits = { rateLimitPerMinute: number; dailyRequestLimit: number };

async function countCalls(reader: Reader, userId: string, since: Date): Promise<number> {
  const [row] = await reader
    .select({ n: sql<number>`count(*)::int` })
    .from(aiRequests)
    .where(
      and(
        eq(aiRequests.userId, userId),
        gte(aiRequests.createdAt, since),
        inArray(aiRequests.status, ["ok", "error"]),
      ),
    );
  return row?.n ?? 0;
}

/** Melempar AppError RATE_LIMITED (429) bila pengguna melewati salah satu batas. */
export async function checkQuota(
  reader: Reader,
  userId: string,
  limits: AiLimits,
  now: Date = new Date(),
): Promise<void> {
  if (limits.rateLimitPerMinute <= 0) {
    throw rateLimited("Kuota AI per menit untuk modul ini diset 0.");
  }
  const minuteCalls = await countCalls(reader, userId, new Date(now.getTime() - 60_000));
  if (minuteCalls >= limits.rateLimitPerMinute) {
    throw rateLimited("Terlalu banyak permintaan AI dalam satu menit. Coba lagi sebentar.");
  }

  if (limits.dailyRequestLimit > 0) {
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dayCalls = await countCalls(reader, userId, dayStart);
    if (dayCalls >= limits.dailyRequestLimit) {
      throw rateLimited("Batas permintaan AI harian tercapai.");
    }
  }
}
