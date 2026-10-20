import { gte } from "drizzle-orm";

import { aiRequests, users } from "@/db/schema";
import { usageByUser, usageSummary } from "@/modules/ai/usage-service";
import { can, loadGrants, type AuthContext } from "@/server/authz";
import { db } from "@/server/db";

/**
 * Skrip uji Tahap 9F: dasbor pemakaian AI (agregasi `ai_requests`).
 * Semua fixture dibuat DALAM SATU transaksi (dua pengguna baru + beberapa
 * ai_requests ber-createdAt di jendela 2099 agar terisolasi dari baris lain),
 * lalu angka agregasi dibandingkan PERSIS. Actor tanpa `ai.requests.read`
 * harus ditolak. Tidak ada jaringan/provider — murni baca/tulis metadata.
 * Diakhiri throw Rollback: tidak ada data tersimpan.
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

// Jendela createdAt terisolasi (tahun 2099) — mustahil bertabrakan dengan baris lain.
const DAY_1 = new Date("2099-01-15T08:00:00.000Z");
const DAY_2 = new Date("2099-01-16T08:00:00.000Z");
const FROM = "2099-01-01";
const TO = "2099-01-31";

async function main() {
  const [admin] = await db.select({ id: users.id }).from(users).limit(1);
  if (!admin) throw new Error("Belum ada pengguna (jalankan db:seed + db:create-admin).");

  const actor: AuthContext = {
    userId: admin.id,
    name: "Admin Uji",
    email: "admin-uji@example.com",
    grants: await loadGrants(admin.id),
  };
  // Actor tanpa izin pemakaian (grants kosong) untuk uji penolakan.
  const noPerm: AuthContext = { ...actor, grants: [] };

  try {
    await db.transaction(async (tx) => {
      assert("actor uji memegang ai.requests.read", can(actor.grants, "ai.requests.read"));

      /* ------------------------- Fixture ------------------------- */
      // Bersihkan jendela 2099 (hanya terlihat dalam tx ini; ikut di-rollback).
      await tx.delete(aiRequests).where(gte(aiRequests.createdAt, new Date(`${FROM}T00:00:00.000Z`)));

      const [u1] = await tx
        .insert(users)
        .values({ name: "Pemakai Satu", email: "usage-uji-a-9f@example.com" })
        .returning({ id: users.id });
      const [u2] = await tx
        .insert(users)
        .values({ name: "Pemakai Dua", email: "usage-uji-b-9f@example.com" })
        .returning({ id: users.id });
      if (!u1 || !u2) throw new Error("Gagal membuat pengguna fixture 9F.");

      // Lima metadata permintaan lintas 2 pengguna / 4 status / 2 fitur / 2 provider.
      await tx.insert(aiRequests).values([
        { userId: u1.id, feature: "report.assistant", provider: "fake", status: "ok", model: "m", reportKey: "trial-balance", inputTokens: 100, outputTokens: 50, estimatedCost: "0.000010", durationMs: 1000, createdAt: DAY_1 },
        { userId: u1.id, feature: "report.assistant", provider: "fake", status: "ok", model: "m", reportKey: "general-ledger", inputTokens: 200, outputTokens: 60, estimatedCost: "0.000020", durationMs: 2000, createdAt: DAY_1 },
        { userId: u1.id, feature: "analysis.assistant", provider: "gemini", status: "error", reportKey: "income-trend", inputTokens: 30, outputTokens: 0, estimatedCost: "0.000000", durationMs: 500, errorClass: "AiError", createdAt: DAY_2 },
        { userId: u2.id, feature: "report.assistant", provider: "fake", status: "validation", inputTokens: 0, outputTokens: 0, estimatedCost: "0.000000", durationMs: null, createdAt: DAY_2 },
        { userId: u2.id, feature: "analysis.assistant", provider: "gemini", status: "rate_limited", inputTokens: 10, outputTokens: 0, estimatedCost: "0.000000", durationMs: 300, createdAt: DAY_2 },
      ]);

      const range = { from: FROM, to: TO };

      /* ---------------- (A) Ringkasan agregat — angka PERSIS ---------------- */
      const sum = await usageSummary(actor, range, tx);
      assert("totalRequests = 5", sum.totalRequests === 5);
      assert("byStatus.ok = 2", sum.byStatus.ok === 2);
      assert("byStatus.error = 1", sum.byStatus.error === 1);
      assert("byStatus.validation = 1", sum.byStatus.validation === 1);
      assert("byStatus.rate_limited = 1", sum.byStatus.rate_limited === 1);
      assert("byFeature.report.assistant = 3", sum.byFeature["report.assistant"] === 3);
      assert("byFeature.analysis.assistant = 2", sum.byFeature["analysis.assistant"] === 2);
      assert("byProvider.fake = 3", sum.byProvider.fake === 3);
      assert("byProvider.gemini = 2", sum.byProvider.gemini === 2);
      assert("inputTokens = 340", sum.inputTokens === 340);
      assert("outputTokens = 110", sum.outputTokens === 110);
      assert("estimatedCost = 0.000030", sum.estimatedCost === "0.000030");
      // Gagal = error+validation+rate_limited+unauthorized = 3 dari 5 => 0.6000.
      assert("errorRate = 0.6000", sum.errorRate === "0.6000");
      // Rata-rata berbobot hanya baris ber-latensi (yang null diabaikan): (1500*2 + 500 + 300)/4 = 950.
      assert("avgDurationMs = 950", sum.avgDurationMs === 950);

      /* ---------------- (B) Pemakaian per pengguna -------------------------- */
      const byUser = await usageByUser(actor, range, tx);
      assert("dua pengguna teragregasi", byUser.length === 2);
      assert("urut desc: pemakai teratas punya 3 permintaan", byUser[0]?.requests === 3);
      assert("u1 = 3 permintaan, 330 input, 110 output", byUser[0]?.userId === u1.id && byUser[0].inputTokens === 330 && byUser[0].outputTokens === 110);
      assert("u2 = 2 permintaan, 10 input", byUser[1]?.userId === u2.id && byUser[1].requests === 2 && byUser[1].inputTokens === 10);

      /* ---------------- (C) Penyempitan filter ------------------------------ */
      const onlyU1 = await usageSummary(actor, { ...range, userId: u1.id }, tx);
      assert("filter userId => total 3", onlyU1.totalRequests === 3);
      const onlyAnalysis = await usageSummary(actor, { ...range, feature: "analysis.assistant" }, tx);
      assert("filter feature => total 2", onlyAnalysis.totalRequests === 2);
      assert("filter feature => analysis.assistant saja", onlyAnalysis.byFeature["analysis.assistant"] === 2 && !("report.assistant" in onlyAnalysis.byFeature));

      /* ---------------- (D) Rentang tanpa kecocokan => nol, bukan error ----- */
      const empty = await usageSummary(actor, { from: "2099-06-01", to: "2099-06-30" }, tx);
      assert("rentang kosong => total 0", empty.totalRequests === 0);
      assert("rentang kosong => errorRate 0.0000", empty.errorRate === "0.0000");
      assert("rentang kosong => avgDuration null", empty.avgDurationMs === null);

      /* ---------------- (E) Guard izin -------------------------------------- */
      await expectFail("usageSummary tanpa ai.requests.read -> forbidden", () => usageSummary(noPerm, range, tx));
      await expectFail("usageByUser tanpa ai.requests.read -> forbidden", () => usageByUser(noPerm, range, tx));

      throw new Rollback("selesai — rollback");
    });
    throw new Error("Transaksi selesai tanpa rollback — fixture bisa tersimpan!");
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log(`\n[test-ai-usage] rollback OK — ${passed} asersi PASS, tidak ada data tersimpan di DB.`);
  }
}

main();
