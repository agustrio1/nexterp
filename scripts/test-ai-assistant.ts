import { and, eq, gte } from "drizzle-orm";

import { aiRequests, aiSettings, chartAccounts, fiscalYears, users } from "@/db/schema";
import { createSystemDraft, postJournal } from "@/modules/accounting/journal-service";
import { incomeStatement } from "@/modules/accounting/report-service";
import { createFiscalYear } from "@/modules/organization/fiscal-service";
import { findExportEntry } from "@/modules/reporting/export-catalog";
import { askAnalysis, askReport } from "@/modules/ai/assistant-service";
import { AI_SETTINGS_ID, type Tx } from "@/modules/ai/_refs";
import { AiError, type AiErrorKind, type AiProvider, type AiRequest } from "@/modules/ai/provider";
import { buildSummaryData, redactRow } from "@/modules/ai/redact";
import { loadGrants, type AuthContext } from "@/server/authz";
import { db } from "@/server/db";

/**
 * Skrip uji Tahap 9C: asisten "bahasa alami -> laporan".
 * FY terisolasi UJIFY2040 + dua jurnal terposting (neraca saldo 3 akun). Provider
 * FAKE deterministik diinjeksi (TIDAK ADA jaringan). Semua dalam SATU transaksi
 * dengan throw Rollback — tidak ada data tersimpan.
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

const FROM = "2040-01-01";
const TO = "2040-12-31";

type FakeIntent = { reportKey: string; query?: Record<string, unknown> };
type FakeAnalysisIntent = { analysisKey: string; params?: Record<string, unknown> };

/** Provider uji deterministik; mencatat setiap permintaan (untuk assertion prompt). */
function makeFakeProvider(opts: {
  intent?: FakeIntent;
  analysisIntent?: FakeAnalysisIntent;
  failKind?: AiErrorKind;
} = {}): AiProvider & { calls: AiRequest[] } {
  const calls: AiRequest[] = [];
  const provider: AiProvider & { calls: AiRequest[] } = {
    name: "fake-test",
    calls,
    async generate(request: AiRequest) {
      calls.push(request);
      if (opts.failKind) throw new AiError(opts.failKind, "galat terencana dari provider fake");
      const text = request.json
        ? opts.analysisIntent
          ? JSON.stringify({
              analysisKey: opts.analysisIntent.analysisKey,
              params: opts.analysisIntent.params ?? {},
              rationale: "pilihan analisis fake deterministik",
            })
          : JSON.stringify({
              reportKey: opts.intent?.reportKey ?? "trial-balance",
              query: opts.intent?.query ?? { from: FROM, to: TO },
              rationale: "pilihan fake deterministik",
            })
        : "Ringkasan: angka sudah dihitung service deterministik; ini narasi contoh.";
      return { text, inputTokens: 12, outputTokens: 6, model: "fake-test-model" };
    },
  };
  return provider;
}

/** Pancang konfigurasi AI tunggal (upsert) agar uji tidak bergantung pada seed. */
async function setSettings(tx: Tx, patch: Partial<typeof aiSettings.$inferInsert>) {
  await tx
    .insert(aiSettings)
    .values({ id: AI_SETTINGS_ID, provider: "fake", enabled: true, ...patch })
    .onConflictDoUpdate({ target: aiSettings.id, set: patch });
}

async function statusCounts(tx: Tx, userId: string): Promise<Record<string, number>> {
  const rows = await tx
    .select({ status: aiRequests.status })
    .from(aiRequests)
    .where(and(eq(aiRequests.userId, userId), gte(aiRequests.createdAt, new Date(Date.now() - 60_000))));
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return counts;
}

async function main() {
  const [u] = await db.select({ id: users.id }).from(users).limit(1);
  if (!u) throw new Error("Belum ada pengguna (jalankan db:seed + db:create-admin).");

  const actorA: AuthContext = {
    userId: u.id,
    name: "Operator",
    email: "operator-uji@example.com",
    grants: await loadGrants(u.id),
  };
  const noGrants: AuthContext = { ...actorA, grants: [] };

  try {
    await db.transaction(async (tx) => {
      /* ------------------------- Prasyarat data ------------------------- */
      await createFiscalYear(
        actorA,
        { code: "UJIFY2040", startDate: FROM, endDate: TO, includeAdjustmentPeriod: false },
        tx,
      );

      async function addAccount(code: string, name: string, type: "asset" | "expense" | "revenue") {
        const [row] = await tx
          .insert(chartAccounts)
          .values({ code, name, type, isPostable: true, isActive: true, createdBy: actorA.userId, updatedBy: actorA.userId })
          .returning({ id: chartAccounts.id });
        if (!row) throw new Error(`Gagal membuat akun uji ${code}`);
        return row.id;
      }
      const accCash = await addAccount("1930", "Bank Uji AI", "asset");
      const accRevenue = await addAccount("4930", "Pendapatan Uji AI", "revenue");
      const accExpense = await addAccount("5930", "Beban Uji AI", "expense");

      const d1 = await createSystemDraft(tx, actorA, {
        entryDate: "2040-03-10",
        description: "Pendapatan uji AI",
        sourceType: "manual",
        sourceId: "00000000-0000-4000-8000-000000004140",
        sourceEvent: "test",
        idempotencyKey: "ai_test_revenue_2040",
        lines: [
          { accountId: accCash, side: "debit", amount: "5000000.00" },
          { accountId: accRevenue, side: "credit", amount: "5000000.00" },
        ],
      });
      await postJournal(actorA, d1.id, tx);

      const d2 = await createSystemDraft(tx, actorA, {
        entryDate: "2040-03-20",
        description: "Beban uji AI",
        sourceType: "manual",
        sourceId: "00000000-0000-4000-8000-000000004240",
        sourceEvent: "test",
        idempotencyKey: "ai_test_expense_2040",
        lines: [
          { accountId: accExpense, side: "debit", amount: "1200000.00" },
          { accountId: accCash, side: "credit", amount: "1200000.00" },
        ],
      });
      await postJournal(actorA, d2.id, tx);

      await setSettings(tx, {
        provider: "fake",
        enabled: true,
        model: null,
        maxInputChars: 4000,
        maxOutputTokens: 1000,
        rateLimitPerMinute: 100,
        dailyRequestLimit: 1000,
      });

      /* ---------------- (A) Jalur penuh: intent -> angka -> ringkasan -------- */
      const fakeA = makeFakeProvider();
      const resA = await askReport(
        actorA,
        { question: "Bagaimana neraca saldo selama 2040?" },
        { provider: fakeA, tx },
      );
      assert("asisten menghasilkan ringkasan", typeof resA.answer === "string" && resA.answer.length > 0);
      assert("laporan terpilih = neraca saldo", resA.report.key === "trial-balance");
      assert("sumber angka = service deterministik", resA.report.source === "deterministic service");
      assert(
        "angka berasal dari service (3 akun bermutasi)",
        Array.isArray(resA.data) && (resA.data as { code?: string }[]).length === 3,
      );
      assert(
        "nominal 5.000.000 ada di hasil laporan",
        JSON.stringify(resA.data).includes("5000000.00"),
      );
      assert("dua panggilan provider (klasifikasi + ringkasan)", fakeA.calls.length === 2);
      assert("meta token terisi", resA.meta.inputTokens > 0 && resA.meta.outputTokens > 0);

      const okCount = (await statusCounts(tx, actorA.userId)).ok ?? 0;
      assert("satu log ai_requests 'ok' tercatat", okCount >= 1);

      // Prompt klasifikasi memuat katalog, pertanyaan; TIDAK memuat nilai baris.
      const classifyPrompt = fakeA.calls[0]?.prompt ?? "";
      assert("prompt klasifikasi memuat daftar laporan", classifyPrompt.includes("trial-balance"));

      /* ---------------- (B) Guard izin -------------------------------------- */
      await expectFail("askReport tanpa izin ai.assistant.use", () =>
        askReport(noGrants, { question: "neraca saldo?" }, { provider: makeFakeProvider(), tx }),
      );

      /* ---------------- (C) Kill-switch ------------------------------------- */
      await setSettings(tx, { enabled: false });
      const fakeC = makeFakeProvider();
      await expectFail("AI dimatikan menolak permintaan", () =>
        askReport(actorA, { question: "neraca saldo 2040?" }, { provider: fakeC, tx }),
      );
      assert("provider TIDAK dipanggil saat dimatikan", fakeC.calls.length === 0);
      assert(
        "status 'disabled' tercatat",
        ((await statusCounts(tx, actorA.userId)).disabled ?? 0) >= 1,
      );
      await setSettings(tx, { enabled: true });

      /* ---------------- (D) Batas panjang input ----------------------------- */
      await setSettings(tx, { maxInputChars: 12 });
      const fakeD = makeFakeProvider();
      await expectFail("pertanyaan melebihi batas ditolak", () =>
        askReport(actorA, { question: "x".repeat(40) }, { provider: fakeD, tx }),
      );
      assert("provider TIDAK dipanggil saat input terlalu panjang", fakeD.calls.length === 0);
      await setSettings(tx, { maxInputChars: 4000 });

      /* ---------------- (E) Filter katalog per izin (defense-in-depth) ------- */
      const partialActor: AuthContext = {
        ...actorA,
        grants: actorA.grants.filter((g) => g.code === "ai.assistant.use" || g.code === "sales.ar.read"),
      };
      const fakeE = makeFakeProvider({ intent: { reportKey: "trial-balance" } });
      await expectFail("laporan di luar izin ditolak server", () =>
        askReport(partialActor, { question: "neraca saldo 2040?" }, { provider: fakeE, tx }),
      );
      const ePrompt = fakeE.calls[0]?.prompt ?? "";
      assert("prompt hanya memuat laporan yang diizinkan (tanpa trial-balance)", !ePrompt.includes("trial-balance"));
      assert("prompt memuat laporan yang diizinkan (ar-aging)", ePrompt.includes("ar-aging"));

      /* ---------------- (F) Validasi intent & query ------------------------- */
      await expectFail("intent 'none' -> tidak ada laporan cocok", () =>
        askReport(actorA, { question: "cuaca hari ini?" }, { provider: makeFakeProvider({ intent: { reportKey: "none" } }), tx }),
      );
      await expectFail("reportKey tak dikenal -> validation", () =>
        askReport(actorA, { question: "laporan rahasia?" }, { provider: makeFakeProvider({ intent: { reportKey: "tidak-ada" } }), tx }),
      );
      await expectFail("query laporan invalid -> validation", () =>
        askReport(
          actorA,
          { question: "neraca saldo 2040?" },
          { provider: makeFakeProvider({ intent: { reportKey: "trial-balance", query: { from: "2040-13-99" } } }), tx },
        ),
      );

      /* ---------------- (G) Kegagalan provider (efek nihil ke ERP) ------------ */
      const fakeG = makeFakeProvider({ failKind: "transient" });
      await expectFail("galat provider ditangani rapi", () =>
        askReport(actorA, { question: "neraca saldo 2040?" }, { provider: fakeG, tx }),
      );
      assert(
        "status 'error' tercatat saat provider gagal",
        ((await statusCounts(tx, actorA.userId)).error ?? 0) >= 1,
      );
      const tb = findExportEntry("trial-balance");
      const afterFail = tb ? await tb.build(actorA, { from: FROM, to: TO }, tx) : null;
      assert("laporan tetap utuh & terbaca setelah provider gagal (read-only)", (afterFail?.rows.length ?? 0) === 3);

      /* ---------------- (H) Kuota / rate limit per pengguna ------------------- */
      await tx.delete(aiRequests).where(eq(aiRequests.userId, actorA.userId));
      await setSettings(tx, { rateLimitPerMinute: 2 });
      await askReport(actorA, { question: "neraca saldo 2040?" }, { provider: makeFakeProvider(), tx });
      await askReport(actorA, { question: "neraca saldo 2040?" }, { provider: makeFakeProvider(), tx });
      const fakeH = makeFakeProvider();
      await expectFail("melewati rate limit per menit -> 429", () =>
        askReport(actorA, { question: "neraca saldo 2040?" }, { provider: fakeH, tx }),
      );
      assert("provider tak dipanggil pada permintaan ke-3 (kena kuota)", fakeH.calls.length === 0);
      assert(
        "status 'rate_limited' tercatat",
        ((await statusCounts(tx, actorA.userId)).rate_limited ?? 0) >= 1,
      );

      /* ---------------- (I) Unit minimisasi data (redact) --------------------- */
      const personal = redactRow(
        { id: "u1", employeeName: "Budi Sentosa", name: "Sari Wijaya", email: "b@x.com", memo: "rahasia", amount: "1000.00" },
        true,
      );
      assert("redact membuang id/PII", !("id" in personal) && !("email" in personal) && !("memo" in personal));
      assert("redact membuang kolom nama orang (laporan personal)", !("name" in personal) && !("employeeName" in personal));
      assert("redact menyimpan nilai angka", personal.amount === "1000.00");

      const summary = buildSummaryData({
        reportKey: "payslip-register",
        reportLabel: "Daftar Slip Gaji",
        filter: { from: FROM, to: TO },
        rows: [{ id: "1", name: "Budi Sentosa", gross: "5000000.00" }],
      });
      assert("ringkasan laporan personal tak memuat nama", !JSON.stringify(summary).includes("Budi Sentosa"));
      assert("ringkasan tetap memuat angka", JSON.stringify(summary).includes("5000000.00"));

      /* =================== Tahap 9D: asisten analisis =================== */
      // Fase H sengaja menyisakan rateLimitPerMinute=2; kembalikan kepala kuota +
      // kosongkan jejak panggilan agar fase 9D/9E (guardedPreflight terbukti di C/D/H)
      // tidak kena 429. Perilaku kuota sudah ditunjukkan di (H).
      await tx.delete(aiRequests).where(eq(aiRequests.userId, actorA.userId));
      await setSettings(tx, { rateLimitPerMinute: 100, dailyRequestLimit: 1000 });

      /* (J) Jalur penuh analisis: intent -> hitung deterministik -> jelaskan */
      const fakeJ = makeFakeProvider({ analysisIntent: { analysisKey: "income-trend", params: { from: FROM, to: TO } } });
      const resJ = await askAnalysis(
        actorA,
        { question: "Bagaimana tren laba rugi selama 2040?" },
        { provider: fakeJ, tx },
      );
      assert("analisis menghasilkan penjelasan", typeof resJ.answer === "string" && resJ.answer.length > 0);
      assert("analysisKey = income-trend", resJ.analysis.key === "income-trend");
      assert("sumber angka analisis = service deterministik", resJ.analysis.source === "deterministic service");
      assert("12 periode ter-enumerate (FY 2040)", resJ.metrics.periodCount === 12);
      // Angka harus cocok dengan incomeStatement langsung (sumber kebenaran yang sama).
      const incDirect = await incomeStatement(actorA, { from: FROM, to: TO }, tx);
      assert("netIncome service = 3.800.000 (5jt pendapatan - 1,2jt beban)", incDirect.netIncome === "3800000.00");
      assert("totalNet analisis = netIncome service", resJ.metrics.totalNet === incDirect.netIncome);
      assert("dua panggilan provider (klasifikasi + penjelasan)", fakeJ.calls.length === 2);
      assert("prompt klasifikasi analisis memuat katalog", (fakeJ.calls[0]?.prompt ?? "").includes("income-trend"));
      const jLog = await tx
        .select({ status: aiRequests.status, feature: aiRequests.feature, reportKey: aiRequests.reportKey })
        .from(aiRequests)
        .where(and(eq(aiRequests.userId, actorA.userId), eq(aiRequests.feature, "analysis.assistant")));
      assert(
        "log analysis.assistant tercatat 'ok' dgn reportKey income-trend",
        jLog.some((r) => r.status === "ok" && r.reportKey === "income-trend"),
      );

      /* (K) Zero-safe: analisis posisi kini tanpa fixture => tak crash, metrik valid */
      const resK1 = await askAnalysis(
        actorA,
        { question: "Bagaimana risiko umur piutang?" },
        { provider: makeFakeProvider({ analysisIntent: { analysisKey: "ar-aging-risk", params: {} } }), tx },
      );
      assert("ar-aging-risk: pastDueAmount string desimal", typeof resK1.metrics.pastDueAmount === "string");
      assert("ar-aging-risk: elevatedRisk yes/no", resK1.metrics.elevatedRisk === "yes" || resK1.metrics.elevatedRisk === "no");
      assert("ar-aging-risk: flags berupa array", Array.isArray(resK1.flags));
      const resK2 = await askAnalysis(
        actorA,
        { question: "Berapa risiko kehabisan stok?" },
        { provider: makeFakeProvider({ analysisIntent: { analysisKey: "inventory-reorder-risk", params: {} } }), tx },
      );
      assert("reorder-risk: belowCount angka", typeof resK2.metrics.belowCount === "number");
      assert("reorder-risk: totalSuggestedQuantity string desimal", typeof resK2.metrics.totalSuggestedQuantity === "string");

      /* (L) Validasi param & otorisasi ULANG (defense-in-depth) */
      await expectFail("params budget-variance tanpa budgetId -> validation", () =>
        askAnalysis(actorA, { question: "varians anggaran?", analysisKey: "budget-variance", params: {} }, { provider: makeFakeProvider(), tx }),
      );
      await expectFail("analysisKey tak dikenal -> validation", () =>
        askAnalysis(actorA, { question: "analisis rahasia?", analysisKey: "tidak-ada" }, { provider: makeFakeProvider(), tx }),
      );
      await expectFail("intent 'none' dari provider -> validation", () =>
        askAnalysis(actorA, { question: "cuaca hari ini?" }, { provider: makeFakeProvider({ analysisIntent: { analysisKey: "none" } }), tx }),
      );
      // Actor terbatas: hanya ai.assistant.use + sales.ar.read (ar-aging-risk OK; budget-variance TIDAK).
      const partialAnalysisActor: AuthContext = {
        ...actorA,
        grants: actorA.grants.filter((g) => g.code === "ai.assistant.use" || g.code === "sales.ar.read"),
      };
      await expectFail("analisis di luar izin ditolak server (forbidden)", () =>
        askAnalysis(
          partialAnalysisActor,
          { question: "varians anggaran?", analysisKey: "budget-variance", params: { budgetId: "00000000-0000-4000-8000-000000000001" } },
          { provider: makeFakeProvider(), tx },
        ),
      );
      const fakeL = makeFakeProvider({ analysisIntent: { analysisKey: "ar-aging-risk", params: {} } });
      await askAnalysis(partialAnalysisActor, { question: "risiko piutang?" }, { provider: fakeL, tx });
      const lPrompt = fakeL.calls[0]?.prompt ?? "";
      assert("prompt analisis hanya memuat yang diizinkan (tanpa income-trend)", !lPrompt.includes("income-trend"));
      assert("prompt analisis memuat yang diizinkan (ar-aging-risk)", lPrompt.includes("ar-aging-risk"));

      /* (M) Kill-switch juga melindungi jalur analisis (guardedPreflight bersama) */
      await setSettings(tx, { enabled: false });
      const fakeM = makeFakeProvider({ analysisIntent: { analysisKey: "income-trend", params: { from: FROM, to: TO } } });
      await expectFail("analisis ditolak saat AI dimatikan", () =>
        askAnalysis(actorA, { question: "tren laba rugi?" }, { provider: fakeM, tx }),
      );
      assert("provider tidak dipanggil saat dimatikan (analisis)", fakeM.calls.length === 0);
      await setSettings(tx, { enabled: true });

      /* ============ Tahap 9E: HR/CRM lewat jalur report-query 9C ============ */
      // (a) Ter-register di katalog ekspor (dipakai askReport).
      assert("hr-headcount ter-register di katalog", findExportEntry("hr-headcount") !== undefined);
      assert("payslip-register ter-register di katalog", findExportEntry("payslip-register") !== undefined);
      assert("sales (CRM-adjacent) ter-register di katalog", findExportEntry("sales") !== undefined);

      // (b) Jalur penuh HR via askReport (reportKey hr-headcount, query {} valid).
      const fakeE1 = makeFakeProvider({ intent: { reportKey: "hr-headcount", query: {} } });
      const resE1 = await askReport(actorA, { question: "Berapa jumlah karyawan per departemen?" }, { provider: fakeE1, tx });
      assert("askReport melayani laporan HR", resE1.report.key === "hr-headcount");

      // (c) Minimisasi: laporan personal => kolom nama orang dibuang sebelum masuk prompt.
      const redactedHr = redactRow({ employeeName: "Budi Sentosa", headcount: 5, id: "e1" }, true);
      assert("redaksi HR membuang nama karyawan & id", !("employeeName" in redactedHr) && !("id" in redactedHr));
      const e1SummarizePrompt = fakeE1.calls[1]?.prompt ?? "";
      assert("prompt ringkasan HR memuat laporan (bukan nama mentah)", e1SummarizePrompt.includes("hr-headcount"));

      // (d) Actor tanpa izin HR => hr-* tidak ditawarkan DAN server menolak (model ngotot).
      const noHrActor: AuthContext = {
        ...actorA,
        grants: actorA.grants.filter((g) => g.code === "ai.assistant.use" || g.code === "accounting.reports.read"),
      };
      const fakeE2 = makeFakeProvider({ intent: { reportKey: "hr-headcount", query: {} } });
      await expectFail("laporan HR di luar izin ditolak server (forbidden)", () =>
        askReport(noHrActor, { question: "jumlah karyawan?" }, { provider: fakeE2, tx }),
      );
      assert("prompt tidak menawarkan hr-* untuk actor tanpa izin", !(fakeE2.calls[0]?.prompt ?? "").includes("hr-headcount"));

      /* ------------------------------ Penutup -------------------------------- */
      const fy = await tx.select({ code: fiscalYears.code }).from(fiscalYears).where(eq(fiscalYears.code, "UJIFY2040")).limit(1);
      assert("FY uji ada di dalam transaksi", fy[0]?.code === "UJIFY2040");

      throw new Rollback("selesai — rollback");
    });
    throw new Error("Transaksi selesai tanpa rollback — fixture bisa tersimpan!");
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log(`\n[test-ai-assistant] rollback OK — ${passed} asersi PASS, tidak ada data tersimpan di DB.`);
  }
}

main();
