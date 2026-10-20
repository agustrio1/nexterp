import { and, asc, eq, gt } from "drizzle-orm";

import { bankAccounts, chartAccounts, fiscalYears, jobRuns, users } from "@/db/schema";
import { createSystemDraft, postJournal } from "@/modules/accounting/journal-service";
import { createFiscalYear } from "@/modules/organization/fiscal-service";
import { cancelJob, enqueueExport, getJob, getJobArtifact, runNextJob } from "@/modules/jobs/job-service";
import { listExportCatalog } from "@/modules/reporting/export-catalog";
import {
  cashFlowDashboard,
  executiveDashboard,
  financeDashboard,
  hrDashboard,
  inventoryDashboard,
  payrollDashboard,
  purchasingDashboard,
  salesDashboard,
} from "@/modules/reporting/dashboard-service";
import type { Tx } from "@/modules/jobs/_refs";
import { loadGrants, type AuthContext } from "@/server/authz";
import { db } from "@/server/db";

/**
 * Skrip uji Tahap 8D: antrian job ekspor CSV + dashboard agregasi.
 * FY terisolasi UJIFY2038 dengan dua jurnal terposting (pendapatan 5.000.000,
 * beban 1.200.000). Alur yang dijalan: enqueue -> klaim SKIP LOCKED -> handler
 * ekspor CSV -> unduh artefak; idempotensi enqueue; pembatalan; backoff retry;
 * dead-letter; penundaan runAt; plus kedelapan dashboard yang hanya menyusun
 * ulang laporan existing. SELURUHNYA dalam SATU transaksi dengan throw Rollback
 * — TIDAK ADA data tersimpan di DB.
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

async function countJobs(tx: Tx, key: string): Promise<number> {
  const rows = await tx
    .select({ id: jobRuns.id })
    .from(jobRuns)
    .where(eq(jobRuns.idempotencyKey, key));
  return rows.length;
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

  const FROM = "2038-01-01";
  const TO = "2038-12-31";

  try {
    await db.transaction(async (tx) => {
      /* ------------------------- Prasyarat data ------------------------- */
      await createFiscalYear(
        actorA,
        { code: "UJIFY2038", startDate: FROM, endDate: TO, includeAdjustmentPeriod: false },
        tx,
      );

      async function addAccount(code: string, name: string, type: "asset" | "expense" | "revenue") {
        const [row] = await tx
          .insert(chartAccounts)
          .values({
            code,
            name,
            type,
            isPostable: true,
            isActive: true,
            createdBy: actorA.userId,
            updatedBy: actorA.userId,
          })
          .returning({ id: chartAccounts.id });
        if (!row) throw new Error(`Gagal membuat akun uji ${code}`);
        return row.id;
      }

      const accCash = await addAccount("1910", "Bank Uji Ekspor", "asset");
      const accRevenue = await addAccount("4910", "Pendapatan Uji Ekspor", "revenue");
      const accExpense = await addAccount("5910", "Beban Uji Ekspor", "expense");

      const [bank] = await tx
        .insert(bankAccounts)
        .values({
          code: "UJ-BANK-38",
          name: "Bank Uji Ekspor",
          accountId: accCash,
          kind: "bank",
          createdBy: actorA.userId,
          updatedBy: actorA.userId,
        })
        .returning({ id: bankAccounts.id });
      if (!bank) throw new Error("Gagal membuat rekening bank uji.");

      // Dua jurnal berimbang pada periode Maret 2038 (sourceId UUID unik per peristiwa).
      const d1 = await createSystemDraft(
        tx,
        actorA,
        {
          entryDate: "2038-03-10",
          description: "Pendapatan uji ekspor",
          sourceType: "manual",
          sourceId: "00000000-0000-4000-8000-000000003138",
          sourceEvent: "test",
          idempotencyKey: "jobs_export_revenue_2038",
          lines: [
            { accountId: accCash, side: "debit", amount: "5000000.00" },
            { accountId: accRevenue, side: "credit", amount: "5000000.00" },
          ],
        },
      );
      await postJournal(actorA, d1.id, tx);

      const d2 = await createSystemDraft(
        tx,
        actorA,
        {
          entryDate: "2038-03-20",
          description: "Beban uji ekspor",
          sourceType: "manual",
          sourceId: "00000000-0000-4000-8000-000000003238",
          sourceEvent: "test",
          idempotencyKey: "jobs_export_expense_2038",
          lines: [
            { accountId: accExpense, side: "debit", amount: "1200000.00" },
            { accountId: accCash, side: "credit", amount: "1200000.00" },
          ],
        },
      );
      await postJournal(actorA, d2.id, tx);

      /* ------------------------------ Katalog ---------------------------- */
      const catalog = listExportCatalog();
      assert(`katalog ekspor memuat ${catalog.length} laporan`, catalog.length >= 27);
      assert(
        "katalog memakai key sesuai rute laporan",
        catalog.some((c) => c.key === "trial-balance") && catalog.some((c) => c.key === "project-profitability"),
      );

      /* ----------------------- Enqueue + jalankan ekspor ------------------ */
      const job1 = await enqueueExport(
        actorA,
        {
          reportKey: "trial-balance",
          query: { from: FROM, to: TO },
          idempotencyKey: "uji-export-tb-2038",
        },
        tx,
      );
      assert("job dibuat berstatus antre", job1.status === "queued" && job1.attempts === 0);
      assert(
        "nomor EXP tertulis pada nama berkas",
        /^trial-balance-EXP-\d{4}-\d{5}\.csv$/.test(job1.fileName ?? ""),
      );
      assert("artefak belum ada saat antre", job1.hasArtifact === false);

      const ran1 = await runNextJob(actorA, tx);
      assert("job diklaim lalu sukses", ran1 !== null && ran1.status === "succeeded");
      assert("satu percobaan tercatat", ran1 !== null && ran1.attempts === 1);
      assert("artefak CSV tersimpan", ran1 !== null && ran1.hasArtifact === true);
      assert(
        "ringkasan hasil memuat jumlah baris",
        ran1 !== null &&
          typeof ran1.result === "object" &&
          ran1.result !== null &&
          (ran1.result as { rowCount?: unknown }).rowCount === 3,
      );

      const artifact = await getJobArtifact(actorA, job1.id, tx);
      const csvLines = artifact.text.trim().split(/\r\n/);
      assert("nama berkas unduhan sama dengan job", artifact.fileName === job1.fileName);
      assert("tipe konten CSV", artifact.contentType.startsWith("text/csv"));
      assert("CSV punya header + 3 baris akun", csvLines.length === 4);
      assert(
        "CSV memuat kode & nominal akun yang bergerak",
        csvLines[0]?.includes("code") === true &&
          csvLines.some((l) => l.includes("1910") && l.includes("5000000.00")) &&
          csvLines.some((l) => l.includes("4910")) &&
          csvLines.some((l) => l.includes("5910") && l.includes("1200000.00")),
      );

      /* -------------------------- Idempotensi ---------------------------- */
      const job1Again = await enqueueExport(
        actorA,
        {
          reportKey: "trial-balance",
          query: { from: FROM, to: TO },
          idempotencyKey: "uji-export-tb-2038",
        },
        tx,
      );
      assert("enqueue kunci sama mengembalikan job yang sama", job1Again.id === job1.id);
      assert("tidak ada baris ganda", (await countJobs(tx, "uji-export-tb-2038")) === 1);

      /* ----------------------------- Guard ------------------------------- */
      await expectFail("reportKey tak dikenal", () =>
        enqueueExport(actorA, { reportKey: "tidak-ada", query: {} }, tx),
      );
      await expectFail("enqueue tanpa izin ekspor", () =>
        enqueueExport(noGrants, { reportKey: "trial-balance", query: { from: FROM, to: TO } }, tx),
      );
      await expectFail("enqueue laporan tanpa izin sumber", () =>
        enqueueExport(
          { ...actorA, grants: actorA.grants.filter((g) => g.code.startsWith("reporting.")) },
          { reportKey: "trial-balance", query: { from: FROM, to: TO } },
          tx,
        ),
      );
      await expectFail("query laporan tidak valid", () =>
        enqueueExport(actorA, { reportKey: "trial-balance", query: { from: "2038-13-99" } }, tx),
      );
      await expectFail("menjalankan job tanpa izin manage", () => runNextJob(noGrants, tx));
      assert("job tetap sukses meski executor tak berhak", (await getJob(actorA, job1.id, tx)).status === "succeeded");

      /* --------------------------- Ekspor kedua -------------------------- */
      const job2 = await enqueueExport(
        actorA,
        { reportKey: "cash-book", query: { from: FROM, to: TO, bankAccountId: bank.id } },
        tx,
      );
      const ran2 = await runNextJob(actorA, tx);
      assert("ekspor buku kas sukses", ran2 !== null && ran2.id === job2.id && ran2.status === "succeeded");
      const cashCsv = (await getJobArtifact(actorA, job2.id, tx)).text;
      assert(
        "CSV buku kas memuat mutasi & saldo berjalan",
        cashCsv.includes("5000000.00") && cashCsv.includes("3800000.00") && cashCsv.includes("balance"),
      );

      /* ------------------------ Retry + backoff -------------------------- */
      const MISSING = "00000000-0000-4000-8000-000000009999";
      const job3 = await enqueueExport(
        actorA,
        { reportKey: "general-ledger", query: { from: FROM, to: TO, accountId: MISSING } },
        tx,
      );
      const ran3 = await runNextJob(actorA, tx);
      assert("gagal pertama kembali ke antrean", ran3 !== null && ran3.status === "queued");
      assert("job yang sama dikembalikan (bukan baru)", ran3 !== null && ran3.id === job3.id);
      assert("percobaan tersimpan", ran3 !== null && ran3.attempts === 1);
      assert(
        "alasan kegagalan tercatat",
        ran3 !== null && typeof ran3.lastError === "string" && ran3.lastError.includes("tidak ditemukan"),
      );
      assert("backoff memundurkan runAt", ran3 !== null && ran3.runAt.getTime() > Date.now());
      assert("klaim dibersihkan untuk percobaan ulang", ran3 !== null && ran3.claimedAt === null);

      const job4 = await enqueueExport(
        actorA,
        {
          reportKey: "general-ledger",
          query: { from: FROM, to: TO, accountId: MISSING },
          maxAttempts: 1,
        },
        tx,
      );
      const ran4 = await runNextJob(actorA, tx);
      assert("habis percobaan menjadi dead-letter", ran4 !== null && ran4.status === "failed");
      assert("finishedAt terisi pada dead-letter", ran4 !== null && ran4.finishedAt !== null);
      assert("dead-letter tidak diambil lagi", (await runNextJob(actorA, tx))?.id !== job4.id);

      /* ----------------------- Tunda lalu batalkan ----------------------- */
      const job5 = await enqueueExport(
        actorA,
        {
          reportKey: "trial-balance",
          query: { from: FROM, to: TO },
          runAt: TO,
          idempotencyKey: "uji-export-cancel-2038",
        },
        tx,
      );
      assert("job tertunda dijadwalkan masa depan", job5.runAt.getTime() > Date.now());
      // Job 3 masih antre tetapi runAt-nya sudah dimundur (backoff) — klaim harus
      // melewati keduanya yang belum jatuh tempo, lalu tidak menemukan apa-apa.
      const idle = await runNextJob(actorA, tx);
      assert("tidak ada job jatuh tempo -> tidak ada yang diklaim", idle === null);

      const cancelled = await cancelJob(actorA, job5.id, tx);
      assert("pembatalan hanya untuk job antre", cancelled.status === "cancelled");
      await expectFail("membatalkan dua kali", () => cancelJob(actorA, job5.id, tx));
      await expectFail("mengunduh artefak job dibatalkan", () => getJobArtifact(actorA, job5.id, tx));

      const job5Again = await enqueueExport(
        actorA,
        {
          reportKey: "trial-balance",
          query: { from: FROM, to: TO },
          runAt: TO,
          idempotencyKey: "uji-export-cancel-2038",
        },
        tx,
      );
      assert("kunci idempotensi dibebaskan oleh pembatalan", job5Again.id !== job5.id);

      /* ----------------------------- Dashboard --------------------------- */
      const fin = await financeDashboard(actorA, { from: FROM, to: TO }, tx);
      assert("dashboard keuangan: pendapatan 5.000.000", fin.profit.revenue === "5000000.00");
      assert("dashboard keuangan: beban 1.200.000", fin.profit.expense === "1200000.00");
      assert("dashboard keuangan: laba bersih 3.800.000", fin.profit.netIncome === "3800000.00");
      assert("dashboard keuangan: aset 3.800.000", fin.position.assets === "3800000.00");
      assert("dashboard keuangan: neraca saldo seimbang", fin.trialBalance.balanced === true);
      assert("dashboard keuangan: 3 akun bermutasi", fin.trialBalance.accounts === 3);

      const exec = await executiveDashboard(actorA, { from: FROM, to: TO }, tx);
      assert("dashboard eksekutif memakai laba yang sama", exec.profit.netIncome === "3800000.00");
      assert("dashboard eksekutif: piutang nol", exec.receivables.outstanding === "0.00");
      assert("dashboard eksekutif: utang nol", exec.payables.outstanding === "0.00");
      assert("dashboard eksekutif: persediaan nol", exec.inventory.value === "0.00");
      assert("dashboard eksekutif: rentang bersumber dari tanggal", exec.range.source === "range");

      const cf = await cashFlowDashboard(actorA, { from: FROM, to: TO }, tx);
      assert("dashboard arus kas: tanpa transaksi kas, neto 0", cf.sections.operating.net === "0.00");
      assert("dashboard arus kas: saldo rekening 3.800.000", cf.reconciliation.closingCash === "3800000.00");
      assert("dashboard arus kas: rekonsiliasi cocok", cf.reconciliation.reconciles === true);

      const sales = await salesDashboard(actorA, { from: FROM, to: TO }, tx);
      assert("dashboard penjualan: invoice 0", sales.totals.invoiceValue === "0.00");
      const purch = await purchasingDashboard(actorA, { from: FROM, to: TO }, tx);
      assert("dashboard pembelian: PO 0", purch.totals.poValue === "0.00");
      const inv = await inventoryDashboard(actorA, {}, tx);
      assert("dashboard persediaan: valuasi 0", inv.valuation.value === "0.00");
      assert("dashboard persediaan: tanpa low stock", inv.lowStock.count === 0);
      const hr = await hrDashboard(actorA, { from: FROM, to: TO }, tx);
      assert("dashboard SDM: headcount terhitung", typeof hr.headcount.total === "number");
      const pay = await payrollDashboard(actorA, {}, tx);
      assert("dashboard payroll: beban gaji 0", pay.totals.grossEarnings === "0.00");

      await expectFail("dashboard tanpa izin", () => executiveDashboard(noGrants, { from: FROM, to: TO }, tx));

      /* ------------------------- Sisa antrian akhir ---------------------- */
      const remaining = await tx
        .select({ id: jobRuns.id, status: jobRuns.status })
        .from(jobRuns)
        .where(and(eq(jobRuns.status, "queued"), gt(jobRuns.runAt, new Date())));
      assert("dua job antre masih tertunda (backoff + runAt)", remaining.length === 2);
      const succeeded = await tx
        .select({ id: jobRuns.id })
        .from(jobRuns)
        .where(eq(jobRuns.status, "succeeded"))
        .orderBy(asc(jobRuns.createdAt));
      assert("tepat dua job sukses", succeeded.length === 2);

      const fy = await tx
        .select({ code: fiscalYears.code })
        .from(fiscalYears)
        .where(eq(fiscalYears.code, "UJIFY2038"))
        .limit(1);
      assert("FY uji ada di dalam transaksi", fy[0]?.code === "UJIFY2038");

      throw new Rollback("selesai — rollback");
    });
    // Tidak pernah sampai ke sini: transaksi selalu ditutup dengan throw Rollback.
    throw new Error("Transaksi selesai tanpa rollback — fixture bisa tersimpan!");
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log(`\n[test-jobs-export] rollback OK — ${passed} asersi PASS, tidak ada data tersimpan di DB.`);
  }
}

main();
