import { and, asc, eq, gte, lte, sql, type SQL } from "drizzle-orm";

import { aiRequests } from "@/db/schema";
import { dec, type Money } from "@/lib/money";
import type { AuthContext } from "@/server/authz";
import { db } from "@/server/db";

import { assertCan, type Reader, type Tx } from "./_refs";
import type { UsageQueryInput } from "./schemas";

/* ------------------------------------------------------------------ */
/* Dasbor pemakaian AI (Tahap 9F).                                      */
/* Murni membaca & mengagregasi `ai_requests` (metadata — tanpa prompt/    */
/* respons). Angka dihitung di DB (count/sum/group by). Dibuka hanya untuk   */
/* pemegang `ai.requests.read` (default: super_admin). Sumber kuota riil     */
/* tetap di provider; ini jejak sisi aplikasi.                               */
/* ------------------------------------------------------------------ */

/** Status yang dihitung sebagai "gagal" untuk rasio error (bukan ok/disabled). */
const FAILURE_STATUSES = new Set(["error", "rate_limited", "validation", "unauthorized"]);

function dateBounds(query: UsageQueryInput): SQL[] {
  const conditions: SQL[] = [];
  if (query.from) conditions.push(gte(aiRequests.createdAt, new Date(`${query.from}T00:00:00.000Z`)));
  if (query.to) conditions.push(lte(aiRequests.createdAt, new Date(`${query.to}T23:59:59.999Z`)));
  if (query.feature) conditions.push(eq(aiRequests.feature, query.feature));
  if (query.userId) conditions.push(eq(aiRequests.userId, query.userId));
  return conditions;
}

export type UsageSummary = {
  range: { from: string | null; to: string | null };
  filters: { feature: string | null; userId: string | null };
  totalRequests: number;
  byStatus: Record<string, number>;
  byFeature: Record<string, number>;
  byProvider: Record<string, number>;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: string;
  errorRate: string;
  avgDurationMs: number | null;
};

/** Ringkasan agregat pemakaian AI sesuai filter. `tx` opsional untuk uji rollback. */
export async function usageSummary(actor: AuthContext, query: UsageQueryInput, tx?: Tx): Promise<UsageSummary> {
  assertCan(actor, "ai.requests.read");
  const bounds = dateBounds(query);
  const where = bounds.length > 0 ? and(...bounds) : undefined;
  const reader: Reader = tx ?? db;

  const grouped = await reader
    .select({
      status: aiRequests.status,
      feature: aiRequests.feature,
      provider: aiRequests.provider,
      requests: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${aiRequests.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${aiRequests.outputTokens}), 0)::int`,
      cost: sql<string>`coalesce(sum(${aiRequests.estimatedCost}), 0)::numeric(18,6)`,
      avgDuration: sql<number | null>`avg(${aiRequests.durationMs})::int`,
    })
    .from(aiRequests)
    .where(where)
    .groupBy(aiRequests.status, aiRequests.feature, aiRequests.provider)
    .orderBy(asc(aiRequests.status), asc(aiRequests.feature), asc(aiRequests.provider));

  const byStatus: Record<string, number> = {};
  const byFeature: Record<string, number> = {};
  const byProvider: Record<string, number> = {};
  let totalRequests = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cost = dec(0);
  let durationWeighted = dec(0);
  let durationRows = 0;
  let failures = 0;

  for (const row of grouped) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + row.requests;
    byFeature[row.feature] = (byFeature[row.feature] ?? 0) + row.requests;
    byProvider[row.provider] = (byProvider[row.provider] ?? 0) + row.requests;
    totalRequests += row.requests;
    inputTokens += row.inputTokens;
    outputTokens += row.outputTokens;
    cost = cost.plus(dec(row.cost));
    if (FAILURE_STATUSES.has(row.status)) failures += row.requests;
    if (row.avgDuration !== null) {
      durationWeighted = durationWeighted.plus(dec(row.avgDuration).times(row.requests));
      durationRows += row.requests;
    }
  }

  // errorRate = permintaan gagal / total (fraksi 4 desimal; tanpa data => 0.0000).
  const errorRate: Money = totalRequests === 0 ? dec(0) : dec(failures).div(dec(totalRequests));
  const avgDurationMs = durationRows === 0 ? null : Number(durationWeighted.div(dec(durationRows)).toFixed(0));

  return {
    range: { from: query.from ?? null, to: query.to ?? null },
    filters: { feature: query.feature ?? null, userId: query.userId ?? null },
    totalRequests,
    byStatus,
    byFeature,
    byProvider,
    inputTokens,
    outputTokens,
    estimatedCost: cost.toFixed(6),
    errorRate: errorRate.toFixed(4),
    avgDurationMs,
  };
}

export type UsageByUserRow = {
  userId: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
};

/** Pemakaian per pengguna (satu permukaan dasbor; difilter rentang/feature yang sama). */
export async function usageByUser(actor: AuthContext, query: UsageQueryInput, tx?: Tx): Promise<UsageByUserRow[]> {
  assertCan(actor, "ai.requests.read");
  const bounds = dateBounds(query);
  const where = bounds.length > 0 ? and(...bounds) : undefined;
  const reader: Reader = tx ?? db;

  const rows = await reader
    .select({
      userId: aiRequests.userId,
      requests: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${aiRequests.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${aiRequests.outputTokens}), 0)::int`,
    })
    .from(aiRequests)
    .where(where)
    .groupBy(aiRequests.userId)
    .orderBy(sql`count(*)::int desc`);

  return rows.map((r) => ({
    userId: r.userId,
    requests: r.requests,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
  }));
}
