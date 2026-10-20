import { eq, sql } from "drizzle-orm";

import { accountingPeriods, chartAccounts, users } from "@/db/schema";
import {
  cancelDraftJournal,
  createDraftJournal,
  postJournal,
  reverseJournal,
} from "@/modules/accounting/journal-service";
import type { JournalLineInput } from "@/modules/accounting/schemas";
import {
  balanceSheet,
  generalLedger,
  incomeStatement,
  trialBalance,
} from "@/modules/accounting/report-service";
import {
  balanceSheetQuerySchema,
  generalLedgerQuerySchema,
  trialBalanceQuerySchema,
} from "@/modules/accounting/report-schemas";
import { loadGrants } from "@/server/authz";
import { db } from "@/server/db";

/**
 * Skrip uji sementara untuk Tahap 4E (Buku besar & laporan keuangan).
 *
 * Seluruh operasi berjalan dalam SATU `db.transaction` dengan `throw Rollback`
 * di akhir, sehingga TIDAK ADA data yang tersimpan (baca saja + draf yang dibuang).
 * Tidak perlu persetujuan Bagian 2.2 karena tidak ada commit.
 *
 * Prasyarat: COA demo (`db:seed-coa`) dan FY2030-P1 open (`scripts/test-fiscal.ts`).
 *
 * Skenario (semua posted pada 2030-01):
 *   J1 05-01 Dr Kas 1.000.000 / Cr Modal 1.000.000            (setoran modal)
 *   J2 15-01 Dr Piutang 500.000 / Cr Pendapatan 500.000       (penjualan kredit)
 *   J3 15-01 Dr Beban Sewa 200.000 / Cr Kas 200.000           (beban sewa)
 *   J4 20-01 Dr Kas 300.000 / Cr Piutang 300.000              (penerimaan piutang)
 *   J5 20-01 Dr HPP 100.000 / Cr Utang Usaha 100.000          (lalu DIREVERSAL -> net 0)
 *   Draft & Cancelled dibuat untuk membuktikan keduanya DIKECUALIKAN.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

class Rollback extends Error {}

function assert(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "GAGAL"}: ${label}`);
  if (!ok) throw new Error(`Aseri gagal: ${label}`);
}

async function expectError(label: string, tx: Tx, fn: () => Promise<unknown>) {
  await tx.execute(sql`savepoint sp_err`);
  try {
    await fn();
    await tx.execute(sql`release savepoint sp_err`);
    console.log(label, "GAGAL: seharusnya ditolak");
  } catch (error) {
    await tx.execute(sql`rollback to savepoint sp_err`);
    const e = error as { code?: string; message?: string };
    console.log(label, e.code ?? "-", "|", e.message ?? String(error));
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
  const actor = {
    userId: u.id,
    name: "Uji",
    email: "uji@example.com",
    grants: await loadGrants(u.id),
  };

  const acc = {
    kas: await accountIdByCode("1111"),
    piutang: await accountIdByCode("1200"),
    utangUsaha: await accountIdByCode("2110"),
    modal: await accountIdByCode("3110"),
    pendapatan: await accountIdByCode("4100"),
    hpp: await accountIdByCode("5100"),
    sewa: await accountIdByCode("5220"),
  };

  const [period] = await db
    .select({ id: accountingPeriods.id })
    .from(accountingPeriods)
    .where(eq(accountingPeriods.startDate, "2030-01-01"))
    .limit(1);
  if (!period) throw new Error("Periode FY2030-P1 belum dibuat. Jalankan scripts/test-fiscal.ts.");

  try {
    await db.transaction(async (tx) => {
      const mk = async (description: string, entryDate: string, lines: JournalLineInput[]) => {
        const draft = await createDraftJournal(actor, { entryDate, description, lines }, tx);
        return postJournal(actor, draft.id, tx);
      };

      /* --- Bangun GL --- */
      await mk("J1 setoran modal", "2030-01-05", [
        { accountId: acc.kas, side: "debit", amount: "1000000.00" },
        { accountId: acc.modal, side: "credit", amount: "1000000.00" },
      ]);
      await mk("J2 penjualan kredit", "2030-01-15", [
        { accountId: acc.piutang, side: "debit", amount: "500000.00" },
        { accountId: acc.pendapatan, side: "credit", amount: "500000.00" },
      ]);
      await mk("J3 beban sewa", "2030-01-15", [
        { accountId: acc.sewa, side: "debit", amount: "200000.00" },
        { accountId: acc.kas, side: "credit", amount: "200000.00" },
      ]);
      await mk("J4 penerimaan piutang", "2030-01-20", [
        { accountId: acc.kas, side: "debit", amount: "300000.00" },
        { accountId: acc.piutang, side: "credit", amount: "300000.00" },
      ]);
      const j5 = await mk("J5 HPP (akan direversal)", "2030-01-20", [
        { accountId: acc.hpp, side: "debit", amount: "100000.00" },
        { accountId: acc.utangUsaha, side: "credit", amount: "100000.00" },
      ]);

      /* Draf (tidak di-post) + Cancelled: keduanya harus DIKECUALIKAN. */
      await createDraftJournal(
        actor,
        {
          entryDate: "2030-01-25",
          description: "DRAF tidak dihitung",
          lines: [
            { accountId: acc.kas, side: "debit", amount: "999999.00" },
            { accountId: acc.pendapatan, side: "credit", amount: "999999.00" },
          ],
        },
        tx,
      );
      const toCancel = await createDraftJournal(
        actor,
        {
          entryDate: "2030-01-25",
          description: "CANCEL tidak dihitung",
          lines: [
            { accountId: acc.kas, side: "debit", amount: "888888.00" },
            { accountId: acc.pendapatan, side: "credit", amount: "888888.00" },
          ],
        },
        tx,
      );
      await cancelDraftJournal(actor, toCancel.id, { reason: "Batal, uji 4E" }, tx);

      /* --- Reversal J5: posted+reversed harus saling meniadakan --- */
      await reverseJournal(actor, j5.id, { reason: "Koreksi uji 4E" }, tx);

      /* ===== R1: Buku besar Kas (from 01-10) — saldo awal + berjalan ===== */
      const glKas = await generalLedger(
        actor,
        { accountId: acc.kas, from: "2030-01-10", to: "2030-01-31" },
        tx,
      );
      assert("R1 normalSide Kas = debit", glKas.normalSide === "debit");
      assert("R1 saldo awal (J1 sebelum 01-10) = 1000000.00", glKas.openingBalance === "1000000.00");
      assert("R1 jumlah mutasi dalam rentang = 2 (J3,J4)", glKas.rows.length === 2);
      assert("R1 saldo berjalan baris1 (J3) = 800000.00", glKas.rows[0]?.balance === "800000.00");
      assert("R1 saldo akhir = 1100000.00", glKas.closingBalance === "1100000.00");

      /* ===== R2: Buku besar Kas via periodId P1 — saldo awal 0, 3 mutasi ===== */
      const glKasP = await generalLedger(actor, { accountId: acc.kas, periodId: period.id }, tx);
      assert("R2 saldo awal via periodId = 0.00", glKasP.openingBalance === "0.00");
      assert("R2 mutasi = 3 (J1,J3,J4)", glKasP.rows.length === 3);
      assert("R2 saldo akhir = 1100000.00", glKasP.closingBalance === "1100000.00");

      /* ===== R3: Neraca saldo (P1) — D = K, reversal ikut & net 0 ===== */
      const tb = await trialBalance(actor, { periodId: period.id }, tx);
      assert("R3 neraca saldo seimbang", tb.totals.balanced === true);
      assert("R3 total debit = 2200000.00", tb.totals.debit === "2200000.00");
      assert("R3 total kredit = 2200000.00", tb.totals.credit === "2200000.00");
      const tbHpp = tb.rows.find((r) => r.accountId === acc.hpp);
      assert("R3 HPP muncul dgn D=K=100000 (net 0)", !!tbHpp && tbHpp.debit === "100000.00" && tbHpp.credit === "100000.00");

      /* ===== R4: Laba rugi (P1) ===== */
      const is = await incomeStatement(actor, { periodId: period.id }, tx);
      assert("R4 total pendapatan = 500000.00", is.totalRevenue === "500000.00");
      assert("R4 total beban = 200000.00 (HPP net 0 krn reversal)", is.totalExpense === "200000.00");
      assert("R4 laba bersih = 300000.00", is.netIncome === "300000.00");
      const hppLine = is.expense.find((r) => r.accountId === acc.hpp);
      assert("R4 baris HPP amount = 0.00", hppLine?.amount === "0.00");

      /* ===== R5: Neraca (asOf 01-31) — A = L + E + laba ditahan ===== */
      const bs = await balanceSheet(actor, { asOf: "2030-01-31" }, tx);
      assert("R5 total aset = 1300000.00", bs.totals.assets === "1300000.00");
      assert("R5 total kewajiban = 0.00 (utang usaha net 0)", bs.totals.liabilities === "0.00");
      assert("R5 laba ditahan sementara = 300000.00", bs.totals.retainedEarnings === "300000.00");
      assert("R5 K+Ek = 1300000.00", bs.totals.liabilitiesAndEquity === "1300000.00");
      assert("R5 NERACA balance", bs.totals.balanced === true);

      /* ===== R6: draf & cancelled tidak memengaruhi Kas (sudah terbukti via 1.1M) ===== */
      assert("R6 kas closing tetap 1100000 (draft/cancel dikecualikan)", glKas.closingBalance === "1100000.00");

      /* ===== R7: permission gate laporan ===== */
      await expectError("R7 GL tanpa izin read", tx, () =>
        generalLedger({ ...actor, grants: [] }, { accountId: acc.kas, from: "2030-01-01", to: "2030-01-31" }, tx),
      );
      await expectError("R7 neraca saldo tanpa izin", tx, () =>
        trialBalance({ ...actor, grants: [] }, { periodId: period.id }, tx),
      );

      /* ===== R8: akun / periode tidak dikenal -> NOT_FOUND ===== */
      const bogus = crypto.randomUUID();
      await expectError("R8 GL akun tak dikenal", tx, () =>
        generalLedger(actor, { accountId: bogus, from: "2030-01-01", to: "2030-01-31" }, tx),
      );
      await expectError("R8 TB periode tak dikenal", tx, () => trialBalance(actor, { periodId: bogus }, tx));

      /* ===== R9: validasi skema (from/to XOR periodId) ===== */
      const bothBad = generalLedgerQuerySchema.safeParse({
        accountId: acc.kas,
        from: "2030-01-01",
        to: "2030-01-31",
        periodId: period.id,
      });
      assert("R9 skema GL menolak from+to+periodId bersamaan", bothBad.success === false);
      const noneBad = trialBalanceQuerySchema.safeParse({});
      assert("R9 skema TB menolak tanpa rentang & periodId", noneBad.success === false);
      const rangeOrderBad = balanceSheetQuerySchema.safeParse({ asOf: "x" });
      assert("R9 skema BS menolak asOf format salah", rangeOrderBad.success === false);

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log("[test-reports] rollback OK — tidak ada data tersimpan di DB.");
    return;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[test-reports] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
