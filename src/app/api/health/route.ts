import { desc, inArray, sql } from "drizzle-orm";
import { connection, NextResponse } from "next/server";

import { aiSettings } from "@/db/schema/ai";
import { jobRuns } from "@/db/schema/jobs";
import { logger, errorFields } from "@/server/logger";
import { db } from "@/server/db";

/**
 * Health check operasional (Tahap 10D).
 * Ditujukan ke probe orchestrator (Vercel/K8s) + runbook manual.
 *
 * Kontrak:
 * - Handler TELANJANG (tanpa `apiHandler`) — bebas CSRF/rate-limit, karena
 *   probe harus selalu lolos bahkan saat bucket IP sedang penuh.
 * - `dynamic = "force-dynamic"` + `await connection()` supaya hasil TIDAK
 *   dibekukan saat build.
 * - Tidak butuh autentikasi — payload hanya berisi status kasar (booleans
 *   + count + latency ms). Tidak ada nomor baris / email / nilai moneter.
 *
 * Status:
 * - 200: semua sehat (db up; queue backlog di bawah ambang; ai_settings ada
 *   ATAU provider = none/offline yang sah).
 * - 503: DB down -> langsung 503 (probe wajib treat ini sebagai tidak sehat).
 * - 503: queue backlog > 1000 (worker macet / DB write penuh — hard fail).
 *
 * Peringatan soft (status tetap 200): queue backlog > 100, ai_settings belum
 * dikonfigurasi — keduanya tidak menghentikan API tapi masuk log warn.
 */
export const dynamic = "force-dynamic";

// Boot timestamp modul — konstan per proses Node. Untuk menghitung uptime.
const BOOT_TS = Date.now();

const QUEUE_WARN_THRESHOLD = 100;
const QUEUE_CRIT_THRESHOLD = 1000;

type Check = { state: "up" | "down" | "unknown"; latencyMs?: number; detail?: string };

export async function GET() {
  await connection();
  const startedAt = Date.now();

  const dbCheck: Check = { state: "unknown" };
  const queueCheck: Check = { state: "unknown" };
  const aiCheck: Check = { state: "unknown" };
  let queueBacklog = 0;

  // 1) DB ping.
  const dbStart = Date.now();
  try {
    await db.execute(sql`select 1`);
    dbCheck.state = "up";
    dbCheck.latencyMs = Date.now() - dbStart;
  } catch (error) {
    dbCheck.state = "down";
    dbCheck.latencyMs = Date.now() - dbStart;
    dbCheck.detail = error instanceof Error ? error.message : String(error);
    logger.error("health db check failed", { ...errorFields(error) });
    // Tanpa DB, cek lain mustahil — langsung keluarkan 503.
    return NextResponse.json(
      {
        status: "error",
        database: dbCheck,
        queue: queueCheck,
        ai: aiCheck,
        time: new Date().toISOString(),
        uptimeMs: startedAt - BOOT_TS,
      },
      { status: 503 },
    );
  }

  // 2) Queue backlog (job queued/running) — indikator worker hidup.
  const queueStart = Date.now();
  try {
    const [row] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(jobRuns)
      .where(inArray(jobRuns.status, ["queued", "running"]));
    queueBacklog = row?.c ?? 0;
    queueCheck.state = queueBacklog > QUEUE_CRIT_THRESHOLD ? "down" : "up";
    queueCheck.latencyMs = Date.now() - queueStart;
    queueCheck.detail = `backlog=${queueBacklog}`;
    if (queueBacklog > QUEUE_WARN_THRESHOLD && queueBacklog <= QUEUE_CRIT_THRESHOLD) {
      logger.warn("health queue backlog above warn threshold", {
        backlog: queueBacklog,
        threshold: QUEUE_WARN_THRESHOLD,
      });
    }
  } catch (error) {
    queueCheck.state = "unknown";
    queueCheck.latencyMs = Date.now() - queueStart;
    logger.warn("health queue check failed", { ...errorFields(error) });
  }

  // 3) ai_settings singleton — harus ada 1 baris (default seeded saat boot)
  //    ATAU provider = "none" yang sah. Tidak pernah query jaringan.
  const aiStart = Date.now();
  try {
    const [row] = await db
      .select({ provider: aiSettings.provider, enabled: aiSettings.enabled })
      .from(aiSettings)
      .orderBy(desc(aiSettings.updatedAt))
      .limit(1);
    aiCheck.state = row ? "up" : "unknown";
    aiCheck.latencyMs = Date.now() - aiStart;
    aiCheck.detail = row ? `provider=${row.provider} enabled=${row.enabled}` : "no singleton row";
  } catch (error) {
    aiCheck.state = "unknown";
    aiCheck.latencyMs = Date.now() - aiStart;
    logger.warn("health ai settings check failed", { ...errorFields(error) });
  }

  const healthy =
    dbCheck.state === "up" &&
    queueCheck.state !== "down";

  const body = {
    status: healthy ? "ok" : "degraded",
    database: dbCheck,
    queue: { ...queueCheck, backlog: queueBacklog },
    ai: aiCheck,
    time: new Date().toISOString(),
    uptimeMs: startedAt - BOOT_TS,
  };

  return NextResponse.json(body, { status: healthy ? 200 : 503 });
}
