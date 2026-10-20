import { eq, sql } from "drizzle-orm";

import { chartAccounts, users } from "@/db/schema";
import {
  importBankStatement,
  listBankStatementLines,
  setStatementLineMatch,
} from "@/modules/accounting/bank-statement-service";
import { createBankAccount } from "@/modules/accounting/bank-account-service";
import {
  createCashTransactionDraft,
  postCashTransaction,
} from "@/modules/accounting/cash-transaction-service";
import {
  autoMatchReconciliation,
  createBankReconciliation,
  finalizeBankReconciliation,
  getReconciliation,
  listBankReconciliations,
} from "@/modules/accounting/reconciliation-service";
import { createFiscalYear } from "@/modules/organization/fiscal-service";
import { loadGrants, type AuthContext } from "@/server/authz";
import { db } from "@/server/db";

/**
 * Skrip uji sementara untuk Tahap 4H-C (impor mutasi bank + rekonsiliasi).
 *
 * Seluruh operasi berjalan dalam SATU `db.transaction` dengan `throw Rollback`
 * di akhir, sehingga TIDAK ADA data tersimpan. BUTUH tabel 4H-C (migrasi 0012).
 * Prasyarat: COA demo (`db:seed-coa`) — akun 1111/4100/5220 tersedia.
 *
 * Cakupan: impor baris, match manual + guard arah/nominal, unmatch, tarik baris
 * saat create, auto-match, guard finalize (baris belum cocok), finalize sukses
 * (saldo statement == buku GL), penguncian setelah final, guard selisih saldo.
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

async function main() {
  const [u] = await db.select({ id: users.id }).from(users).limit(1);
  if (!u) throw new Error("Belum ada pengguna.");

  const acc = {
    kas: await accountIdByCode("1111"),
    pendapatan: await accountIdByCode("4100"),
    beban: await accountIdByCode("5220"),
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
          { code: "accounting.bank_accounts.read", branchId: null },
          { code: "accounting.bank_accounts.manage", branchId: null },
          { code: "accounting.cash_transactions.read", branchId: null },
          { code: "accounting.cash_transactions.manage", branchId: null },
          { code: "accounting.bank_reconciliations.read", branchId: null },
          { code: "accounting.bank_reconciliations.manage", branchId: null },
        ],
      };

      // Tahun fiskal terisolasi.
      await createFiscalYear(
        actor,
        { code: "FY2045", startDate: "2045-01-01", endDate: "2045-12-31", includeAdjustmentPeriod: false },
        tx,
      );

      const cash = await createBankAccount(
        actor,
        { code: "BA-REC", name: "Rek Uji", accountId: acc.kas, kind: "bank" },
        tx,
      );

      const postCash = async (input: Parameters<typeof createCashTransactionDraft>[1]) => {
        const draft = await createCashTransactionDraft(actor, input, tx);
        await postCashTransaction(actor, draft.id, tx);
        return draft.id;
      };

      // Jurnal kas: +3.000.000 (masuk), -800.000 (keluar), -50.000 (biaya bank).
      const receiptId = await postCash({
        transactionDate: "2045-02-05",
        type: "receipt",
        bankAccountId: cash.id,
        contraAccountId: acc.pendapatan,
        amount: "3000000.00",
        description: "Penerimaan jasa",
      });
      await postCash({
        transactionDate: "2045-02-15",
        type: "disbursement",
        bankAccountId: cash.id,
        contraAccountId: acc.beban,
        amount: "800000.00",
        description: "Bayar beban",
      });
      await postCash({
        transactionDate: "2045-02-20",
        type: "disbursement",
        bankAccountId: cash.id,
        contraAccountId: acc.beban,
        amount: "50000.00",
        description: "Biaya admin bank",
      });

      // ---- Impor mutasi bank ----
      const imported = await importBankStatement(
        actor,
        {
          bankAccountId: cash.id,
          lines: [
            { statementDate: "2045-02-06", direction: "in", amount: "3000000.00", description: "Transfer masuk" },
            { statementDate: "2045-02-14", direction: "out", amount: "800000.00", description: "Pembayaran", reference: "BBM-1" },
            { statementDate: "2045-02-20", direction: "out", amount: "50000.00", description: "Fee admin" },
          ],
        },
        tx,
      );
      assert("Impor 3 baris statement", imported.imported === 3);

      const listed = await listBankStatementLines(actor, { bankAccountId: cash.id }, tx);
      assert("Daftar baris statement = 3", listed.items.length === 3);
      const lineIn = listed.items.find((l) => l.direction === "in")!;
      const lineOut = listed.items.find((l) => l.amount === "800000.00")!;

      // ---- Match manual + guard arah/nominal ----
      const matched = await setStatementLineMatch(actor, lineIn.id, { cashTransactionId: receiptId }, tx);
      assert("Match manual: baris masuk tertaut transaksi kas", matched.matchedCashTransactionId === receiptId);

      await expectError("Match manual arah/nominal tak cocok", tx, "BUSINESS_RULE", () =>
        setStatementLineMatch(actor, lineOut.id, { cashTransactionId: receiptId }, tx),
      );

      const unmatched = await setStatementLineMatch(actor, lineIn.id, { cashTransactionId: null }, tx);
      assert("Unmatch: tautan dilepas", unmatched.matchedCashTransactionId === null);

      // ---- Buat rekonsiliasi (tarik baris, TANPA auto-match) ----
      const rec = await createBankReconciliation(
        actor,
        {
          bankAccountId: cash.id,
          startDate: "2045-02-01",
          endDate: "2045-02-28",
          statementOpeningBalance: "0.00",
          statementClosingBalance: "2150000.00",
          autoMatch: false,
        },
        tx,
      );
      assert("Create menarik 3 baris", rec.pulled === 3);
      assert("Rekonsiliasi draft belum bernomor", rec.status === "draft" && rec.docNo === null);
      assert("Ringkasan: 0 tercocok, 3 belum", rec.summary.matchedLines === 0 && rec.summary.unmatchedLines === 3);
      assert("Net mutasi statement 2.150.000", rec.summary.netStatementMovement === "2150000.00");

      // ---- Guard finalize sebelum semua cocok ----
      await expectError("Finalize dengan baris belum cocok", tx, "BUSINESS_RULE", () =>
        finalizeBankReconciliation(actor, rec.id, tx),
      );

      // ---- Auto-match lalu finalize ----
      const auto = await autoMatchReconciliation(actor, rec.id, 3, tx);
      assert("Auto-match mencocokkan 3 baris", auto.matchedCount === 3);

      const beforeFinal = await getReconciliation(actor, rec.id, tx);
      assert("Ringkasan: semua tercocok", beforeFinal.summary.matchedLines === 3 && beforeFinal.summary.unmatchedLines === 0);

      const final = await finalizeBankReconciliation(actor, rec.id, tx);
      assert("Status menjadi final", final.status === "final");
      assert("Nomor dokumen diawali BR", final.docNo?.startsWith("BR") === true);
      assert("Saldo buku awal 0.00", final.bookBalanceStart === "0.00");
      assert("Saldo buku akhir 2.150.000", final.bookBalanceEnd === "2150000.00");
      assert("Saldo statement akhir == buku", final.statementClosingBalance === "2150000.00");

      // ---- Penguncian setelah final ----
      await expectError("Finalize ulang (bukan draft)", tx, "BUSINESS_RULE", () =>
        finalizeBankReconciliation(actor, rec.id, tx),
      );
      await expectError("Auto-match ulang (bukan draft)", tx, "BUSINESS_RULE", () =>
        autoMatchReconciliation(actor, rec.id, 3, tx),
      );
      await expectError("Match manual baris di dokumen final", tx, "BUSINESS_RULE", () =>
        setStatementLineMatch(actor, lineIn.id, { cashTransactionId: receiptId }, tx),
      );

      // ---- Filter baca ----
      const matchedOnly = await listBankStatementLines(actor, { bankAccountId: cash.id, matched: true }, tx);
      assert("Filter matched=true -> 3 baris", matchedOnly.items.length === 3);
      const recList = await listBankReconciliations(actor, { bankAccountId: cash.id, status: "final" }, tx);
      assert("Daftar rekonsiliasi final berisi dokumen ini", recList.items.some((r) => r.id === rec.id));

      // ---- Guard selisih saldo (dokumen kedua, tarik 0 baris, saldo statement salah) ----
      const rec2 = await createBankReconciliation(
        actor,
        {
          bankAccountId: cash.id,
          startDate: "2045-02-01",
          endDate: "2045-02-28",
          statementOpeningBalance: "0.00",
          statementClosingBalance: "2150100.00",
          autoMatch: false,
        },
        tx,
      );
      assert("Dokumen kedua menarik 0 baris (sudah tertugaskan)", rec2.pulled === 0);
      await expectError("Finalize dengan selisih saldo", tx, "BUSINESS_RULE", () =>
        finalizeBankReconciliation(actor, rec2.id, tx),
      );

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log(`[test-reconciliation] rollback OK — ${passed} asersi PASS, tidak ada data tersimpan di DB.`);
    return;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[test-reconciliation] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
