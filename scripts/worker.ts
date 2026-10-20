import { asc, eq } from "drizzle-orm";

import { users } from "@/db/schema";
import { db } from "@/server/db";
import { loadGrants, type AuthContext } from "@/server/authz";
import { runNextJob } from "@/modules/jobs/job-service";

/* ------------------------------------------------------------------ */
/* Worker latar belakang (Tahap 8E).                                   */
/* Daemon long-running yang mem-poll antrean `job_runs` dan menjalankan */
/* satu pekerjaan per siklus via runNextJob (FOR UPDATE SKIP LOCKED),   */
/* sehingga banyak instance worker aman berjalan paralel tanpa dobel    */
/* proses. Ini BUKAN proses serverless — jalankan sebagai layanan       */
/* tersendiri (mis. `bun run jobs:worker` pada VM/container/Fly/Railway)*/
/* atau bangunkan terjadwal (cron) yang memanggil satu siklus.          */
/* ------------------------------------------------------------------ */

const DEFAULT_POLL_MS = 3_000;

function pollIntervalMs(): number {
  const raw = process.env.WORKER_POLL_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_POLL_MS;
}

/**
 * Identitas pemroses. Default pengguna aktif pertama (super_admin hasil seed);
 * kunci lewat `WORKER_USER_ID` untuk memakai akun service khusus. Worker hanya
 * mengklaim jenis job yang izin eksekusinya ia pegang (lihat job-service).
 */
async function resolveExecutor(): Promise<AuthContext> {
  const envId = process.env.WORKER_USER_ID?.trim();
  const rows =
    envId && envId.length > 0
      ? await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(eq(users.id, envId))
          .limit(1)
      : await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(eq(users.status, "active"))
          .orderBy(asc(users.createdAt))
          .limit(1);

  const user = rows[0];
  if (!user) {
    throw new Error(
      "Worker: tidak ada pengguna untuk bertindak sebagai pemroses (jalankan db:seed + db:create-admin, atau set WORKER_USER_ID).",
    );
  }
  return { userId: user.id, name: user.name, email: user.email, grants: await loadGrants(user.id) };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Tidur `ms` tetapi terbangun lebih cepat bila `stopping()` menjadi true. */
async function idleSleep(ms: number, stopping: () => boolean): Promise<void> {
  const step = 100;
  for (let waited = 0; waited < ms && !stopping(); waited += step) {
    await sleep(Math.min(step, ms - waited));
  }
}

async function main(): Promise<void> {
  const executor = await resolveExecutor();
  const interval = pollIntervalMs();
  let stopping = false;
  let processed = 0;

  const requestStop = (signal: string): void => {
    console.log(`[worker] ${signal} diterima — menyelesaikan job berjalan lalu berhenti.`);
    stopping = true;
  };
  process.once("SIGINT", () => requestStop("SIGINT"));
  process.once("SIGTERM", () => requestStop("SIGTERM"));

  console.log(
    `[worker] mulai sebagai ${executor.name} <${executor.email}> (poll ${interval}ms). Tekan Ctrl+C untuk berhenti.`,
  );

  while (!stopping) {
    let job: Awaited<ReturnType<typeof runNextJob>> = null;
    try {
      job = await runNextJob(executor);
    } catch (error) {
      // Galat level transaksi DB membatalkan transaksi job — ia tetap antre
      // dan dicoba lagi. Kita lanjutkan polling.
      console.error("[worker] galat siklus:", error instanceof Error ? error.message : String(error));
    }

    if (job) {
      processed += 1;
      const reason = job.lastError ? ` :: ${job.lastError}` : "";
      console.log(
        `[worker] ${job.type} #${job.id.slice(0, 8)} -> ${job.status} (percobaan ${job.attempts}/${job.maxAttempts})${reason}`,
      );
      continue; // langsung klaim pekerjaan berikutnya bila ada
    }

    await idleSleep(interval, () => stopping);
  }

  console.log(`[worker] berhenti. ${processed} job diproses pada sesi ini.`);
  process.exit(0);
}

main().catch((error) => {
  console.error("[worker] gagal total:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
