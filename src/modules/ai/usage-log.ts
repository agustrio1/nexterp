import { aiRequests } from "@/db/schema";
import { db } from "@/server/db";

import type { Reader } from "./_refs";
import type { AiRequestStatus } from "./schemas";

/* ------------------------------------------------------------------ */
/* Pencatatan pemakaian AI (Tahap 9B).                                 */
/* Menulis `ai_requests` berisi METADATA saja — tidak pernah prompt     */
/* atau respons. Sumber dasar dasbor kuota/pemakaian (9F). Dipanggil    */
/* di luar transaksi bisnis (auto-commit) agar kegagalan pun tercatat.  */
/* ------------------------------------------------------------------ */

export type AiUsageEntry = {
  userId: string;
  feature: string;
  provider: string;
  model?: string | null;
  status: AiRequestStatus;
  reportKey?: string | null;
  /** Hanya parameter aman (rentang tanggal, dsb) — bukan nilai baris data. */
  filters?: Record<string, unknown> | null;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCost?: string;
  durationMs?: number | null;
  errorClass?: string | null;
};

export async function logAiRequest(entry: AiUsageEntry, reader: Reader = db): Promise<void> {
  await reader.insert(aiRequests).values({
    userId: entry.userId,
    feature: entry.feature,
    provider: entry.provider,
    model: entry.model ?? null,
    status: entry.status,
    reportKey: entry.reportKey ?? null,
    filters: entry.filters ?? null,
    inputTokens: entry.inputTokens ?? 0,
    outputTokens: entry.outputTokens ?? 0,
    estimatedCost: entry.estimatedCost ?? "0",
    durationMs: entry.durationMs ?? null,
    errorClass: entry.errorClass ?? null,
  });
}
