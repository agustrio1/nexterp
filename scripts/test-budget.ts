import { eq, sql } from "drizzle-orm";

import { chartAccounts, users } from "@/db/schema";
import { createBankAccount } from "@/modules/accounting/bank-account-service";
import {
  approveBudget,
  createBudget,
  replaceBudgetLines,
  updateBudget,
} from "@/modules/accounting/budget-service";
import {
  createCashTransactionDraft,
  postCashTransaction,
} from "@/modules/accounting/cash-transaction-service";
import { budgetRealization, cashFlowStatement } from "@/modules/accounting/report-service";
import { createFiscalYear } from "@/modules/organization/fiscal-service";
import type { AuthContext } from "@/server/authz";
import { loadGrants } from "@/server/authz";
import { db } from "@/server/db";

/**
 * Skrip uji sementara untuk Tahap 4I (Anggaran + laporan arus kas).
 *
 * Seluruh operasi berjalan dalam SATU `db.transaction` dengan `throw Rollback`
 * di akhir, sehingga TIDAK ADA data tersimpan. BUTUH tabel 4I (migrasi 0011)
 * sudah ada. Prasyarat: COA demo (`db:seed-coa`) — akun 1111/4100/5220 tersedia.
 *
 * Cakupan uji:
 *  - createBudget draf (header + baris) + guard duplikat/akun-induk/periode-lintas-FY.
 *  - updateBudget & replaceBudgetLines saat draft.
 *  - budgetRealization: realisasi = mutasi jurnal posted akun pada periode baris.
 *  - cashFlowStatement (metode langsung dari cash_transactions) + rekonsiliasi GL.
 *  - approveBudget (draft -> approved, nomor BGT) + penguncian setelah approved.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

class Rollback extends Error {}

let passed = 0;
function assert(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "GAGAL"}: ${label}`);
  if (!ok) throw new Error(`Aseri gagal: ${label}`);
  passed += 1;
}

async function expectError(
  label: string,
  tx: Tx,
  expectedCode: string,
  fn: () => Promise<unknown>,
) {
  await tx.execute(sql`savepoint sp_err`);
  try {
    await fn();
    await tx.execute(sql`release savepoint sp_err`);
    assert(`${label} (seharusnya ${expectedCode})`, false);
  } catch (error) {
    await tx.execute(sql`rollback to savepoint sp_err`);
    const e = error as { code?: string; message?: string };
    console.log(`  ${label} -> ${e.code ?? "-"} | ${e.message ?? String(error)}`);
    assert(`${label} = ${expectedCode}`, e.code === expectedCode);
  }
}

async function accountIdByCode(code: string): Promise<string> {
  const [row] = await db
    .select({ id: chartAccounts.id })
    .from(chartAccounts)
    .where(eq(chartAccounts.code, code))
    .limit(1);
  if (!row) throw new Error(`Akun ${code} tidak ada. Jalankan \`bun run db:seed-coa\`.`);
  return row.id;
}

async function firstNonPostableAccountId(): Promise<string> {
  const [row] = await db
    .select({ id: chartAccounts.id, code: chartAccounts.code })
    .from(chartAccounts)
    .where(eq(chartAccounts.isPostable, false))
    .limit(1);
  if (!row) throw new Error("Tidak ada akun induk (non-postable) di COA demo.");
  return row.id;
}

async function main() {
  const [u] = await db.select({ id: users.id }).from(users).limit(1);
  if (!u) throw new Error("Belum ada pengguna.");

  const acc = {
    kas: await accountIdByCode("1111"),
    pendapatan: await accountIdByCode("4100"),
    beban: await accountIdByCode("5220"),
    induk: await firstNonPostableAccountId(),
  };

  try {
    await db.transaction(async (tx) => {
      const grants = await loadGrants(u.id);
      const actor: AuthContext = {
        userId: u.id,
        name: "Uji",
        email: "uji@example.com",
        grants: [
          ...grants,
          { code: "accounting.budgets.read", branchId: null },
          { code: "accounting.budgets.manage", branchId: null },
          { code: "accounting.bank_accounts.read", branchId: null },
          { code: "accounting.bank_accounts.manage", branchId: null },
          { code: "accounting.cash_transactions.read", branchId: null },
          { code: "accounting.cash_transactions.manage", branchId: null },
        ],
      };

      // ---- Tahun fiskal terisolasi ----
      const fy = await createFiscalYear(
        actor,
        { code: "FY2043", startDate: "2043-01-01", endDate: "2043-12-31", includeAdjustmentPeriod: false },
        tx,
      );
      assert("FY2043 dibuat dengan 12 periode", fy.periods.length === 12);
      const period1 = fy.periods[0]!;

      // FY lain untuk guard periode lintas tahun fiskal.
      const fy2 = await createFiscalYear(
        actor,
        { code: "FY2044", startDate: "2044-01-01", endDate: "2044-12-31", includeAdjustmentPeriod: false },
        tx,
      );
      const foreignPeriod = fy2.periods[0]!;

      // ---- Actual: jurnal via transaksi kas (Dr/Cr akun pendapatan & beban) ----
      const cash = await createBankAccount(
        actor,
        { code: "BA-CASH", name: "Kas Uji", accountId: acc.kas, kind: "cash" },
        tx,
      );
      const postCash = async (input: Parameters<typeof createCashTransactionDraft>[1]) =>
        postCashTransaction(actor, (await createCashTransactionDraft(actor, input, tx)).id, tx);

      await postCash({
        transactionDate: "2043-01-10",
        type: "receipt",
        bankAccountId: cash.id,
        contraAccountId: acc.pendapatan,
        amount: "3000000.00",
        description: "Penerimaan jasa",
      });
      await postCash({
        transactionDate: "2043-01-20",
        type: "disbursement",
        bankAccountId: cash.id,
        contraAccountId: acc.beban,
        amount: "800000.00",
        description: "Bayar beban",
      });

      // ---- Anggaran draft ----
      const budget = await createBudget(
        actor,
        {
          name: "RKAP 2043",
          fiscalYearId: fy.id,
          lines: [
            { accountId: acc.pendapatan, periodId: period1.id, amount: "5000000.00" },
            { accountId: acc.beban, periodId: period1.id, amount: "1000000.00" },
          ],
        },
        tx,
      );
      assert("Budget dibuat berstatus draft", budget.status === "draft");
      assert("Budget belum bernomor saat draft", budget.docNo === null);
      assert("Budget punya 2 baris", budget.lines.length === 2);

      // ---- Guard validasi baris ----
      await expectError("Baris anggaran duplikat (akun+periode)", tx, "CONFLICT", () =>
        createBudget(
          actor,
          {
            name: "Duplikat",
            fiscalYearId: fy.id,
            lines: [
              { accountId: acc.pendapatan, periodId: period1.id, amount: "1.00" },
              { accountId: acc.pendapatan, periodId: period1.id, amount: "2.00" },
            ],
          },
          tx,
        ),
      );
      await expectError("Baris memakai akun induk (non-postable)", tx, "BUSINESS_RULE", () =>
        createBudget(
          actor,
          { name: "Salah Akun", fiscalYearId: fy.id, lines: [{ accountId: acc.induk, periodId: period1.id, amount: "100.00" }] },
          tx,
        ),
      );
      await expectError("Baris periode milik FY lain", tx, "BUSINESS_RULE", () =>
        createBudget(
          actor,
          { name: "Salah Periode", fiscalYearId: fy.id, lines: [{ accountId: acc.pendapatan, periodId: foreignPeriod.id, amount: "100.00" }] },
          tx,
        ),
      );

      // ---- Update header & replace lines (masih draft) ----
      const renamed = await updateBudget(actor, budget.id, { name: "RKAP 2043 (revisi)" }, tx);
      assert("Header anggaran diupdate saat draft", renamed.name === "RKAP 2043 (revisi)");

      const replaced = await replaceBudgetLines(actor, budget.id, {
        lines: [
          { accountId: acc.pendapatan, periodId: period1.id, amount: "5000000.00" },
          { accountId: acc.beban, periodId: period1.id, amount: "1000000.00" },
        ],
      }, tx);
      assert("Replace lines tetap 2 baris", replaced.lines.length === 2);

      // ---- Realisasi vs anggaran ----
      const realization = await budgetRealization(actor, { budgetId: budget.id }, tx);
      const revLine = realization.lines.find((l) => l.accountCode === "4100")!;
      const expLine = realization.lines.find((l) => l.accountCode === "5220")!;
      assert("Realisasi pendapatan 3.000.000 (Cr 4100)", revLine.actual === "3000000.00");
      assert("Varian pendapatan -2.000.000", revLine.variance === "-2000000.00");
      assert("Realisasi beban 800.000 (Dr 5220)", expLine.actual === "800000.00");
      assert("Varian beban -200.000", expLine.variance === "-200000.00");
      assert("Total anggaran 6.000.000", realization.totals.budget === "6000000.00");
      assert("Total realisasi 3.800.000", realization.totals.actual === "3800000.00");

      // ---- Laporan arus kas (metode langsung) ----
      const cf = await cashFlowStatement(actor, { from: "2043-01-01", to: "2043-12-31" }, tx);
      assert("Arus kas metode langsung", cf.method === "direct");
      assert("Operating inflow 3.000.000", cf.operating.inflow === "3000000.00");
      assert("Operating outflow 800.000", cf.operating.outflow === "800000.00");
      assert("Operating net 2.200.000", cf.operating.net === "2200000.00");
      assert("Net change from transactions 2.200.000", cf.netChangeFromTransactions === "2200000.00");
      assert("Transfer internal 0", cf.internalTransfers === "0.00");
      assert("Rekonsiliasi: saldo awal kas 0", cf.reconciliation.openingCash === "0.00");
      assert("Rekonsiliasi: pergerakan lain 0 (hanya dari transaksi kas)", cf.reconciliation.otherMovements === "0.00");
      assert("Rekonsiliasi: saldo akhir kas 2.200.000", cf.reconciliation.closingCash === "2200000.00");
      assert("Rekonsiliasi cocok", cf.reconciliation.reconciles === true);

      // ---- Persetujuan + penguncian ----
      const approved = await approveBudget(actor, budget.id, tx);
      assert("Anggaran menjadi approved", approved.status === "approved");
      assert("Nomor dokumen diawali BGT", approved.docNo?.startsWith("BGT") === true);

      await expectError("Ubah header setelah approved", tx, "BUSINESS_RULE", () =>
        updateBudget(actor, budget.id, { name: "Coba ubah" }, tx),
      );
      await expectError("Ganti baris setelah approved", tx, "BUSINESS_RULE", () =>
        replaceBudgetLines(actor, budget.id, {
          lines: [{ accountId: acc.pendapatan, periodId: period1.id, amount: "9.00" }],
        }, tx),
      );
      await expectError("Setujui ulang (bukan draft)", tx, "BUSINESS_RULE", () =>
        approveBudget(actor, budget.id, tx),
      );

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log(`[test-budget] rollback OK — ${passed} asersi PASS, tidak ada data tersimpan di DB.`);
    return;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[test-budget] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
