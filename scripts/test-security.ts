import { and, eq, lt, sql } from "drizzle-orm";

import { apiRateLimits, jobRuns, users } from "@/db/schema";
import { getJob, getJobArtifact, listJobs } from "@/modules/jobs/job-service";
import type { Tx } from "@/modules/jobs/_refs";
import type { AuthContext, Grant } from "@/server/authz";
import {
  apiBucket,
  apiGroupFromPath,
  appOriginFrom,
  clientIpFrom,
  isUnsafeMethod,
  sameOriginViolation,
} from "@/server/csrf";
import { db } from "@/server/db";
import { enforceRateLimit } from "@/server/rate-limit";
import { apiSecurityHeaders, globalSecurityHeaders, securityHeaders } from "@/server/security-headers";

/**
 * Skrip uji Tahap 10B: CSRF (guard murni) + rate-limit DB (upsert atomik) +
 * IDOR job/ekspor (creator-only + override manage) + header keamanan (prod vs dev).
 * Semuanya berada DALAM SATU transaksi dengan `throw Rollback` di akhir —
 * TIDAK ADA data tersimpan di DB. Tidak ada provider/jaringan.
 */

class Rollback extends Error {}

let passed = 0;
function assert(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "GAGAL"}: ${label}`);
  if (!ok) throw new Error(`Aseri gagal: ${label}`);
  passed += 1;
}

async function expectFail(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    assert(`${label} (harusnya ditolak)`, false);
  } catch {
    assert(`${label} ditolak`, true);
  }
}

/** Header test adapter — `Headers` standar Web tersedia sejak Node 18. */
function headersOf(map: Record<string, string>): { get(name: string): string | null } {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) lower[k.toLowerCase()] = v;
  return { get: (name: string) => lower[name.toLowerCase()] ?? null };
}

async function main() {
  const [admin] = await db.select({ id: users.id }).from(users).limit(1);
  if (!admin) throw new Error("Belum ada pengguna (jalankan db:seed + db:create-admin).");

  // (1) CSRF + (2) Headers: MURNI — tanpa DB. Di luar tx agar cepat.
  /* ---------------------------------------------------------------- */
  const APP = "https://erp.example.com";
  const origin = appOriginFrom(APP);
  assert("appOriginFrom membuang path & trailing slash", origin === "https://erp.example.com");

  assert(
    "CSRF lolos saat Origin == APP_URL",
    sameOriginViolation(headersOf({ origin: "https://erp.example.com" }), origin) === undefined,
  );
  assert(
    "CSRF tolak Origin beda",
    typeof sameOriginViolation(headersOf({ origin: "https://evil.test" }), origin) === "string",
  );
  assert(
    "CSRF lolos saat Referer prefix sama",
    sameOriginViolation(headersOf({ referer: "https://erp.example.com/journals" }), origin) === undefined,
  );
  assert(
    "CSRF tolak Referer beda",
    typeof sameOriginViolation(headersOf({ referer: "https://evil.test/x" }), origin) === "string",
  );
  assert(
    "CSRF lolos saat Origin & Referer absen (klien non-browser)",
    sameOriginViolation(headersOf({}), origin) === undefined,
  );

  assert("isUnsafeMethod POST/PUT/PATCH/DELETE", ["POST", "PUT", "PATCH", "DELETE"].every(isUnsafeMethod));
  assert("isUnsafeMethod GET/HEAD/OPTIONS = false", ["GET", "HEAD", "OPTIONS", "get"].some(isUnsafeMethod) === false);
  assert("clientIpFrom x-forwarded-for pertama", clientIpFrom(headersOf({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })) === "203.0.113.7");
  assert("clientIpFrom fallback 0", clientIpFrom(headersOf({})) === "0");
  assert("apiGroupFromPath /api/journals/[id]", apiGroupFromPath("/api/journals/abc") === "journals");
  assert("apiGroupFromPath /api/health", apiGroupFromPath("/api/health") === "health");
  assert("apiBucket bentuk stabil", apiBucket("journals", "1.2.3.4") === "api:journals:1.2.3.4");

  const prodGlobal = globalSecurityHeaders(true);
  const devGlobal = globalSecurityHeaders(false);
  const api = apiSecurityHeaders();
  const prodBundle = securityHeaders(true);
  assert("prod: HSTS hadir", prodGlobal.some((h) => h.key === "Strict-Transport-Security"));
  assert("dev: HSTS absen", !devGlobal.some((h) => h.key === "Strict-Transport-Security"));
  assert("global: X-Content-Type-Options nosniff", prodGlobal.some((h) => h.key === "X-Content-Type-Options" && h.value === "nosniff"));
  assert("global: Referrer-Policy no-referrer", prodGlobal.some((h) => h.key === "Referrer-Policy" && h.value === "no-referrer"));
  assert("api: CSP frame-ancestors none", api.some((h) => h.key === "Content-Security-Policy" && h.value.includes("frame-ancestors 'none'")));
  assert("api: X-Frame-Options DENY", api.some((h) => h.key === "X-Frame-Options" && h.value === "DENY"));
  assert("api: Cache-Control no-store", api.some((h) => h.key === "Cache-Control" && h.value === "no-store"));
  assert("securityHeaders(true) punya 2 matcher (global + api)", prodBundle.length === 2);
  assert("matcher global source=/:path*", prodBundle[0]?.source === "/:path*");
  assert("matcher api source=/api/:path*", prodBundle[1]?.source === "/api/:path*");

  // (3) Rate-limit + (4) IDOR: butuh DB — satu transaksi + rollback.
  /* ---------------------------------------------------------------- */
  try {
    await db.transaction(async (tx) => {
      /* ---------------- Rate-limit DB (fixed window) ---------------- */
      const baseNow = new Date("2099-03-14T00:00:00.000Z");
      const bucket = apiBucket("security-test", "203.0.113.99");

      // Pastikan bersih dalam tx (baris mungkin tertinggal dari percobaan sebelumnya).
      await tx.delete(apiRateLimits).where(eq(apiRateLimits.key, bucket));

      await enforceRateLimit(tx, bucket, 3, baseNow);
      await enforceRateLimit(tx, bucket, 3, new Date(baseNow.getTime() + 1000));
      await enforceRateLimit(tx, bucket, 3, new Date(baseNow.getTime() + 2000));
      await expectFail("panggilan ke-4 dalam jendela -> 429", () =>
        enforceRateLimit(tx, bucket, 3, new Date(baseNow.getTime() + 3000)),
      );

      // Lanjut dalam jendela yang sama — tetap 429 karena count terus naik.
      await expectFail("panggilan ke-5 (masih jendela) -> 429", () =>
        enforceRateLimit(tx, bucket, 3, new Date(baseNow.getTime() + 30_000)),
      );

      // Jendela basi (windowStart digeser manual > 1 menit).
      await tx
        .update(apiRateLimits)
        .set({ windowStart: new Date(baseNow.getTime() - 2 * 60_000) })
        .where(eq(apiRateLimits.key, bucket));
      await enforceRateLimit(tx, bucket, 3, new Date(baseNow.getTime() + 120_000));
      const [row] = await tx
        .select({ count: apiRateLimits.count })
        .from(apiRateLimits)
        .where(eq(apiRateLimits.key, bucket));
      assert("jendela basi -> count reset ke 1", row?.count === 1);

      // Cleanup best-effort: baris jauh basi dihapus saat reset jendela.
      const staleKey = apiBucket("security-test", "203.0.113.98");
      await tx.insert(apiRateLimits).values({
        key: staleKey,
        windowStart: new Date("2000-01-01T00:00:00.000Z"),
        count: 1,
      });
      await enforceRateLimit(tx, bucket, 3, new Date(baseNow.getTime() + 300_000));
      const staleGone = await tx
        .select({ id: sql<number>`1` })
        .from(apiRateLimits)
        .where(and(eq(apiRateLimits.key, staleKey), lt(apiRateLimits.windowStart, new Date("2000-06-01"))));
      assert("cleanup best-effort hapus baris basi", staleGone.length === 0);

      /* ---------------------- IDOR job/ekspor ----------------------- */
      // Dua pengguna fixture + satu job milik masing-masing.
      const [ua] = await tx
        .insert(users)
        .values({ name: "IDOR A", email: "idor-a-10b@example.com" })
        .returning({ id: users.id });
      const [ub] = await tx
        .insert(users)
        .values({ name: "IDOR B", email: "idor-b-10b@example.com" })
        .returning({ id: users.id });
      if (!ua || !ub) throw new Error("Gagal membuat pengguna fixture IDOR.");

      const READ: Grant = { code: "reporting.exports.read", branchId: null };
      const MANAGE: Grant = { code: "reporting.exports.manage", branchId: null };
      const actorA: AuthContext = { userId: ua.id, name: "A", email: "a@x", grants: [READ] };
      const actorB: AuthContext = { userId: ub.id, name: "B", email: "b@x", grants: [READ] };
      const adminOverride: AuthContext = {
        userId: admin.id,
        name: "Admin",
        email: "admin@x",
        grants: [READ, MANAGE],
      };
      const readOnlyNoGrants: AuthContext = { userId: ua.id, name: "A0", email: "a@x", grants: [] };

      const jobA = await insertJob(tx, ua.id, "idor-a-10b");
      const jobB = await insertJob(tx, ub.id, "idor-b-10b");

      // Tanpa izin read sama sekali -> 403 oleh assertCan.
      await expectFail("getJob tanpa izin read -> forbidden", () => getJob(readOnlyNoGrants, jobA.id, tx));
      await expectFail("getJobArtifact tanpa izin read -> forbidden", () =>
        getJobArtifact(readOnlyNoGrants, jobA.id, tx),
      );

      // Pemegang read boleh melihat job MILIK SENDIRI.
      const gA = await getJob(actorA, jobA.id, tx);
      assert("getJob kreator atas job sendiri -> ok", gA.id === jobA.id);
      const artA = await getJobArtifact(actorA, jobA.id, tx);
      assert("getJobArtifact kreator atas job sendiri -> ok", artA.fileName === `idor-a-10b.csv`);

      // Pemegang read TIDAK boleh melihat job pengguna lain.
      await expectFail("getJob non-kreator tanpa manage -> forbidden", () => getJob(actorA, jobB.id, tx));
      await expectFail("getJobArtifact non-kreator tanpa manage -> forbidden", () =>
        getJobArtifact(actorA, jobB.id, tx),
      );

      // Override admin (exports.manage) boleh akses lintas-kreator.
      const gB = await getJob(adminOverride, jobB.id, tx);
      assert("getJob admin manage -> lolos untuk job milik B", gB.id === jobB.id);
      const artB = await getJobArtifact(adminOverride, jobB.id, tx);
      assert("getJobArtifact admin manage -> lolos untuk job milik B", artB.fileName === `idor-b-10b.csv`);

      // listJobs: non-admin difaksakan hanya job sendiri (Tahap 10C keyset).
      const listA = await listJobs(actorA, { limit: 100 }, tx);
      const visibleToA = listA.items.filter((r) => r.id === jobA.id || r.id === jobB.id);
      assert(
        "listJobs non-manage: hanya job sendiri muncul (dua fixture)",
        visibleToA.length === 1 && visibleToA[0]?.id === jobA.id,
      );
      const listB = await listJobs(actorB, { limit: 100 }, tx);
      const visibleToB = listB.items.filter((r) => r.id === jobA.id || r.id === jobB.id);
      assert(
        "listJobs non-manage B: hanya job sendiri muncul",
        visibleToB.length === 1 && visibleToB[0]?.id === jobB.id,
      );
      // Filter query.createdBy dicoba untuk intip job orang lain -> diabaikan untuk non-manage.
      const listPeek = await listJobs(actorA, { limit: 100, createdBy: ub.id }, tx);
      const peekHits = listPeek.items.filter((r) => r.id === jobB.id);
      assert("listJobs non-manage dengan createdBy asing -> 0 baris asing", peekHits.length === 0);

      // Admin (manage) tetap bisa memfilter bebas.
      const listAdmin = await listJobs(adminOverride, { limit: 100, createdBy: ub.id }, tx);
      const adminHits = listAdmin.items.filter((r) => r.id === jobB.id);
      assert("listJobs admin dengan createdBy -> menemukan job B", adminHits.length === 1);

      throw new Rollback("selesai — rollback");
    });
    throw new Error("Transaksi selesai tanpa rollback — fixture bisa tersimpan!");
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log(`\n[test-security] rollback OK — ${passed} asersi PASS, tidak ada data tersimpan di DB.`);
  }
}

/** Sisip job ekspor berstatus succeeded dengan artefak CSV minimal. */
async function insertJob(tx: Tx, createdBy: string, marker: string) {
  const [row] = await tx
    .insert(jobRuns)
    .values({
      type: "export.report",
      status: "succeeded",
      payload: { reportKey: marker, query: {} },
      result: { rowCount: 1 },
      artifactText: `code,name\n${marker},"baris uji"\n`,
      contentType: 'text/csv; charset="utf-8"',
      fileName: `${marker}.csv`,
      attempts: 1,
      maxAttempts: 3,
      createdBy,
      updatedBy: createdBy,
    })
    .returning({ id: jobRuns.id });
  if (!row) throw new Error("Gagal menyisip job fixture.");
  return row;
}

main();
