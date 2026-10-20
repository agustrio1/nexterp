import { eq, sql } from "drizzle-orm";

import { chartAccounts, users } from "@/db/schema";
import {
  createBankAccount,
  updateBankAccount,
} from "@/modules/accounting/bank-account-service";
import {
  cancelCashTransaction,
  createCashTransactionDraft,
  postCashTransaction,
  reverseCashTransaction,
} from "@/modules/accounting/cash-transaction-service";
import { cashBook, trialBalance } from "@/modules/accounting/report-service";
import type { CreateCashTransactionInput } from "@/modules/accounting/cash-schemas";
import { createFiscalYear } from "@/modules/organization/fiscal-service";
import type { AuthContext } from "@/server/authz";
import { loadGrants } from "@/server/authz";
import { db } from "@/server/db";

/**
 * Skrip uji sementara untuk Tahap 4H-A/B (Kas & bank: rekening + transaksi).
 *
 * Seluruh operasi berjalan dalam SATU `db.transaction` dengan `throw Rollback`
 * di akhir, sehingga TIDAK ADA data tersimpan. BUTUH tabel 4H (migrasi 0010)
 * sudah ada karena memakai relasi baru.
 *
 * Catatan:
 *  - 4 permission 4H belum di-seed; actor uji menambahkan kode itu manual ke
 *    `loadGrants` (super_admin sudah punya journals.*, reports.*, dsb.).
 *  - Tahun fiskal terisolasi (FY2042) agar posting jurnal memakai periode terbuka.
 *  - Transaksi kas memposting jurnal double-entry; reversal meniadakan efek saldo.
 *
 * Prasyarat: COA demo (`db:seed-coa`) — akun 1111/1112/4100/5220 tersedia.
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
    bank: await accountIdByCode("1112"),
    pendapatan: await accountIdByCode("4100"),
    sewa: await accountIdByCode("5220"),
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
        ],
      };

      // ---- FY2042 terisolasi ----
      const fy = await createFiscalYear(
        actor,
        { code: "FY2042", startDate: "2042-01-01", endDate: "2042-12-31", includeAdjustmentPeriod: false },
        tx,
      );
      assert("FY2042 dibuat dengan 12 periode", fy.periods.length === 12);

      // ===== Rekening kas/bank =====
      const cashA = await createBankAccount(
        actor,
        { code: "BA-CASH", name: "Kas Kantor", accountId: acc.kas, kind: "cash" },
        tx,
      );
      const bankB = await createBankAccount(
        actor,
        { code: "BA-BANK", name: "Bank Operating", accountId: acc.bank, kind: "bank" },
        tx,
      );
      assert("Rekening kas dibuat (glAccountId terisi)", cashA.accountId === acc.kas);
      assert("Rekening bank dibuat", bankB.accountId === acc.bank);

      await expectError("Rekening akun non-aset (pendapatan)", tx, "BUSINESS_RULE", () =>
        createBankAccount(actor, { code: "BA-BAD", name: "Salah", accountId: acc.pendapatan, kind: "bank" }, tx),
      );
      await expectError("Rekening kode ganda", tx, "CONFLICT", () =>
        createBankAccount(actor, { code: "BA-CASH", name: "Duplikat", accountId: acc.kas, kind: "cash" }, tx),
      );
      await expectError("Rekening tanpa izin", tx, "FORBIDDEN", () =>
        createBankAccount({ ...actor, grants: [] }, { code: "BA-NOPE", name: "Tak berhak", accountId: acc.kas, kind: "cash" }, tx),
      );

      // ===== Transaksi kas: helper draf -> post =====
      const post = async (input: CreateCashTransactionInput) => {
        const draft = await createCashTransactionDraft(actor, input, tx);
        return postCashTransaction(actor, draft.id, tx);
      };

      // R1: penerimaan Dr kas / Cr pendapatan
      const receipt = await post({
        transactionDate: "2042-01-10",
        type: "receipt",
        bankAccountId: cashA.id,
        contraAccountId: acc.pendapatan,
        amount: "1000000.00",
        description: "Penerimaan jasa",
      });
      assert("R1 status posted", receipt.status === "posted");
      assert("R1 punya journalEntryId", !!receipt.journalEntryId);
      assert("R1 nomor dokumen diawali CT", receipt.docNo?.startsWith("CT") === true);

      // R2: pengeluaran Dr beban / Cr kas
      const disbursement = await post({
        transactionDate: "2042-01-12",
        type: "disbursement",
        bankAccountId: cashA.id,
        contraAccountId: acc.sewa,
        amount: "400000.00",
        description: "Bayar sewa",
      });
      assert("R2 posted", disbursement.status === "posted");

      // R3: transfer kas -> bank
      const transfer = await post({
        transactionDate: "2042-01-15",
        type: "transfer",
        bankAccountId: cashA.id,
        counterpartBankAccountId: bankB.id,
        amount: "200000.00",
        description: "Setor ke bank",
      });
      assert("R3 transfer posted", transfer.status === "posted");

      // ===== Buku kas per rekening =====
      const bookA = await cashBook(actor, { bankAccountId: cashA.id, from: "2042-01-01", to: "2042-12-31" }, tx);
      assert("Buku kas A: saldo awal 0", bookA.openingBalance === "0.00");
      assert("Buku kas A: saldo akhir 400.000 (1.000.000 - 400.000 - 200.000)", bookA.closingBalance === "400000.00");
      assert("Buku kas A: total masuk 1.000.000", bookA.totals.in === "1000000.00");
      assert("Buku kas A: total keluar 600.000", bookA.totals.out === "600000.00");

      const bookB = await cashBook(actor, { bankAccountId: bankB.id, from: "2042-01-01", to: "2042-12-31" }, tx);
      assert("Buku bank B: saldo akhir 200.000", bookB.closingBalance === "200000.00");

      // ===== Reversal pengeluaran meniadakan efeknya =====
      const reversed = await reverseCashTransaction(
        actor,
        disbursement.id,
        { reason: "Salah catat pengeluaran" },
        tx,
      );
      assert("Reversal menandai transaksi reversed", reversed.status === "reversed");

      const bookA2 = await cashBook(actor, { bankAccountId: cashA.id, from: "2042-01-01", to: "2042-12-31" }, tx);
      assert("Buku kas A pasca-reversal: saldo akhir 800.000", bookA2.closingBalance === "800000.00");

      // ===== Trial balance FY2042 tetap seimbang =====
      const tb = await trialBalance(actor, { from: "2042-01-01", to: "2042-12-31" }, tx);
      assert("Neraca saldo seimbang", tb.totals.balanced === true);

      // ===== Guard pembatalan & posting ganda =====
      const draftToCancel = await createCashTransactionDraft(
        actor,
        { transactionDate: "2042-02-01", type: "receipt", bankAccountId: cashA.id, contraAccountId: acc.pendapatan, amount: "50000.00", description: "Draf dibatalkan" },
        tx,
      );
      const cancelled = await cancelCashTransaction(actor, draftToCancel.id, { reason: "Batal karena uji" }, tx);
      assert("Draf dibatalkan status cancelled", cancelled.status === "cancelled");
      await expectError("Posting transaksi cancelled", tx, "BUSINESS_RULE", () =>
        postCashTransaction(actor, draftToCancel.id, tx),
      );

      await expectError("Posting ulang transaksi posted", tx, "BUSINESS_RULE", () =>
        postCashTransaction(actor, receipt.id, tx),
      );
      await expectError("Reversal draf (belum posted)", tx, "BUSINESS_RULE", () =>
        reverseCashTransaction(actor, draftToCancel.id, { reason: "Coba reversal draf" }, tx),
      );

      // ===== Guard validasi service =====
      await expectError("Penerimaan tanpa akun lawan", tx, "VALIDATION_FAILED", () =>
        createCashTransactionDraft(actor, { transactionDate: "2042-02-02", type: "receipt", bankAccountId: cashA.id, amount: "10.00", description: "Tanpa contra" }, tx),
      );
      await expectError("Transfer tanpa rekening tujuan", tx, "VALIDATION_FAILED", () =>
        createCashTransactionDraft(actor, { transactionDate: "2042-02-02", type: "transfer", bankAccountId: cashA.id, amount: "10.00", description: "Tanpa tujuan" }, tx),
      );

      // ===== Guard menonaktifkan rekening yang masih dipakai =====
      await expectError("Nonaktif rekening dengan transaksi aktif", tx, "CONFLICT", () =>
        updateBankAccount(actor, cashA.id, { isActive: false }, tx),
      );

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log(`[test-cash] rollback OK — ${passed} asersi PASS, tidak ada data tersimpan di DB.`);
    return;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[test-cash] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
