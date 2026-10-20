import { and, eq, lt, sql } from "drizzle-orm";

import { accountingPeriods, chartAccounts, companySettings, fiscalYears, users } from "@/db/schema";
import {
  closeFiscalYear,
  createClosingEntryDraft,
  createOpeningBalanceDraft,
} from "@/modules/accounting/closing-service";
import {
  cancelDraftJournal,
  createDraftJournal,
  postJournal,
} from "@/modules/accounting/journal-service";
import {
  balanceSheet,
  incomeStatement,
  trialBalance,
} from "@/modules/accounting/report-service";
import type { JournalLineInput } from "@/modules/accounting/schemas";
import { changePeriodStatus, createFiscalYear } from "@/modules/organization/fiscal-service";
import type { AuthContext } from "@/server/authz";
import { loadGrants } from "@/server/authz";
import { db } from "@/server/db";

/**
 * Skrip uji sementara untuk Tahap 4F (Saldo awal & penutupan tahun fiskal).
 *
 * Seluruh operasi berjalan dalam SATU `db.transaction` dengan `throw Rollback`
 * di akhir, sehingga TIDAK ADA data yang tersimpan. Karena itu skrip ini TIDAK
 * memerlukan persetujuan Bagian 2.2 (tidak ada commit ke DB).
 *
 * Catatan penting:
 *  - Permission `accounting.opening.manage` & `accounting.closing.manage` belum
 *    di-seed (dan guard DB 0008 belum di-apply). Actor uji dibangun dengan
 *    menambahkan kedua kode itu secara manual ke hasil `loadGrants`.
 *  - Tahun fiskal diuji dibuat terisolasi (FY2040) lewat `createFiscalYear(..., tx)`
 *    agar tidak menabrak FY2030/FY2031 yang dikomit `scripts/test-fiscal.ts`.
 *
 * Prasyarat: COA demo (`db:seed-coa`) — akun 1111/3110/3200/4100/5220 tersedia.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

class Rollback extends Error {}

let passed = 0;
function assert(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "GAGAL"}: ${label}`);
  if (!ok) throw new Error(`Aseri gagal: ${label}`);
  passed += 1;
}

/** Menjalankan `fn` yang SEHARUSNYA gagal dengan kode error tertentu. */
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
    modal: await accountIdByCode("3110"),
    retained: await accountIdByCode("3200"),
    pendapatan: await accountIdByCode("4100"),
    sewa: await accountIdByCode("5220"),
  };

  try {
    await db.transaction(async (tx) => {
      // Actor uji: grant asli + dua permission 4F (belum di-seed).
      const grants = await loadGrants(u.id);
      const actor: AuthContext = {
        userId: u.id,
        name: "Uji",
        email: "uji@example.com",
        grants: [
          ...grants,
          { code: "accounting.opening.manage", branchId: null },
          { code: "accounting.closing.manage", branchId: null },
        ],
      };

      // Setel akun laba ditahan pada company_settings (jsonb string).
      await tx
        .insert(companySettings)
        .values({ key: "retained_earnings_account_id", value: acc.retained, updatedBy: u.id })
        .onConflictDoUpdate({
          target: companySettings.key,
          set: { value: acc.retained, updatedBy: u.id },
        });

      // ---- FY2040 terisolasi (12 periode, tanpa periode penyesuaian) ----
      const fy = await createFiscalYear(
        actor,
        {
          code: "FY2040",
          startDate: "2040-01-01",
          endDate: "2040-12-31",
          includeAdjustmentPeriod: false,
        },
        tx,
      );
      const periodId = (no: number) => {
        const p = fy.periods.find((x) => x.periodNo === no);
        if (!p) throw new Error(`Periode ${no} tidak ada.`);
        return p.id;
      };
      assert("FY2040 dibuat dengan 12 periode", fy.periods.length === 12);

      // ===== O1: saldo awal (draf -> posting), tanggal = awal tahun =====
      const openingDraft = await createOpeningBalanceDraft(actor, {
        fiscalYearId: fy.id,
        description: "Saldo awal FY2040",
        lines: [
          { accountId: acc.kas, side: "debit", amount: "5000000.00" },
          { accountId: acc.modal, side: "credit", amount: "5000000.00" },
        ],
      }, tx);
      assert("O1 draf saldo awal ber-sumber opening_balance", openingDraft.sourceType === "opening_balance");
      assert("O1 draf saldo awal tanggal = awal tahun", openingDraft.entryDate === "2040-01-01");
      assert("O1 draf saldo awal status draft", openingDraft.status === "draft");

      const opening = await postJournal(actor, openingDraft.id, tx);
      assert("O1 saldo awal terposting punya docNo", !!opening.docNo);
      assert("O1 saldo awal jatuh di P1", opening.periodId === periodId(1));
      assert("O1 saldo awal seimbang 5.000.000", opening.totalDebit === "5000000.00" && opening.totalCredit === "5000000.00");

      // ===== O2: duplikat saldo awal pada tahun sama -> CONFLICT =====
      await expectError("O2 duplikat saldo awal", tx, "CONFLICT", () =>
        createOpeningBalanceDraft(actor, {
          fiscalYearId: fy.id,
          description: "Saldo awal duplikat",
          lines: [
            { accountId: acc.kas, side: "debit", amount: "1.00" },
            { accountId: acc.modal, side: "credit", amount: "1.00" },
          ],
        }, tx),
      );

      // ===== O3: tanpa izin opening -> FORBIDDEN =====
      await expectError("O3 saldo awal tanpa izin", tx, "FORBIDDEN", () =>
        createOpeningBalanceDraft({ ...actor, grants: [] }, {
          fiscalYearId: fy.id,
          description: "Saldo awal tak berhak",
          lines: [
            { accountId: acc.kas, side: "debit", amount: "2.00" },
            { accountId: acc.modal, side: "credit", amount: "2.00" },
          ],
        }, tx),
      );

      // ===== Mutasi P1: pendapatan & beban (laba bersih 600.000) =====
      const mk = async (description: string, entryDate: string, lines: JournalLineInput[]) => {
        const d = await createDraftJournal(actor, { entryDate, description, lines }, tx);
        return postJournal(actor, d.id, tx);
      };
      await mk("Pendapatan jasa", "2040-01-10", [
        { accountId: acc.kas, side: "debit", amount: "1000000.00" },
        { accountId: acc.pendapatan, side: "credit", amount: "1000000.00" },
      ]);
      await mk("Beban sewa", "2040-01-15", [
        { accountId: acc.sewa, side: "debit", amount: "400000.00" },
        { accountId: acc.kas, side: "credit", amount: "400000.00" },
      ]);

      // ===== P1: draf memblokir penutupan periode =====
      const blockDraft = await createDraftJournal(
        actor,
        {
          entryDate: "2040-01-20",
          description: "Draf menghalangi tutup periode",
          lines: [
            { accountId: acc.kas, side: "debit", amount: "10.00" },
            { accountId: acc.modal, side: "credit", amount: "10.00" },
          ],
        },
        tx,
      );
      await expectError("P1 tutup periode saat ada draf", tx, "BUSINESS_RULE", () =>
        changePeriodStatusClose(actor, tx, periodId(1)),
      );
      await cancelDraftJournal(actor, blockDraft.id, { reason: "Batal untuk uji blokir" }, tx);
      const p1closed = await changePeriodStatusClose(actor, tx, periodId(1));
      assert("P1 berhasil ditutup setelah draf dibatalkan", p1closed.status === "closed");

      // ===== C1: jurnal penutup otomatis (draf -> posting) =====
      const closingDraft = await createClosingEntryDraft(actor, { fiscalYearId: fy.id }, tx);
      const cLines = closingDraft.lines;
      const lineOf = (code: string) => cLines.find((l) => l.accountCode === code);
      assert("C1 penutup dpt kode 4100 (Dr)", lineOf("4100")?.debit === "1000000.00");
      assert("C1 penutup dpt kode 5220 (Cr)", lineOf("5220")?.credit === "400000.00");
      assert("C1 penampung laba ditahan 3200 (Cr 600.000)", lineOf("3200")?.credit === "600000.00");
      assert("C1 penutup seimbang 1.000.000", closingDraft.totalDebit === "1000000.00" && closingDraft.totalCredit === "1000000.00");
      assert("C1 penutup ber-sumber closing_entry", closingDraft.sourceType === "closing_entry");
      assert("C1 penutup tanggal = akhir tahun", closingDraft.entryDate === "2040-12-31");

      const closing = await postJournal(actor, closingDraft.id, tx);
      assert("C1 penutup terposting di P12", closing.periodId === periodId(12));

      // ===== C2: penutupan awal — masih ada periode belum tertutup =====
      await expectError("C2 tutup tahun sebelum semua periode closed", tx, "BUSINESS_RULE", () =>
        closeFiscalYear(actor, fy.id, tx),
      );

      // ===== Tutup seluruh periode + tahun fiskal sebelumnya (agar aturan urutan lolos) =====
      await tx
        .update(accountingPeriods)
        .set({ status: "closed" })
        .where(and(eq(accountingPeriods.fiscalYearId, fy.id), sql`${accountingPeriods.status} <> 'closed'`));
      await tx
        .update(fiscalYears)
        .set({ status: "closed" })
        .where(lt(fiscalYears.endDate, fy.startDate));

      // ===== C3: tutup tahun sukses =====
      const closedYear = await closeFiscalYear(actor, fy.id, tx);
      assert("C3 FY2040 status closed", closedYear.status === "closed");
      assert("C3 closedBy terisi", closedYear.closedBy === u.id);

      // ===== C4: idempoten — tutup ulang tetap closed =====
      const again = await closeFiscalYear(actor, fy.id, tx);
      assert("C4 tutup ulang idempoten", again.status === "closed");

      // ===== C5: draf penutup kedua setelah tahun ditutup -> BUSINESS_RULE =====
      await expectError("C5 penutup kedua pada tahun closed", tx, "BUSINESS_RULE", () =>
        createClosingEntryDraft(actor, { fiscalYearId: fy.id }, tx),
      );

      // ===== C6: tanpa izin closing -> FORBIDDEN =====
      await expectError("C6 closing tanpa izin", tx, "FORBIDDEN", () =>
        closeFiscalYear({ ...actor, grants: [] }, fy.id, tx),
      );

      // ===== R: laporan pasca-penutupan =====
      const is = await incomeStatement(
        actor,
        { from: "2040-01-01", to: "2040-12-31" },
        tx,
      );
      assert("R laba rugi pendapatan net 0 (sudah ditutup)", is.totalRevenue === "0.00");
      assert("R laba rugi beban net 0 (sudah ditutup)", is.totalExpense === "0.00");
      assert("R laba bersih 0", is.netIncome === "0.00");

      const bs = await balanceSheet(actor, { asOf: "2040-12-31" }, tx);
      assert("R neraca aset 5.600.000", bs.totals.assets === "5600000.00");
      assert("R neraca laba ditahan sementara 0", bs.totals.retainedEarnings === "0.00");
      assert("R neraca ekuitas akun 5.600.000 (3110+3200)", bs.totals.equity === "5600000.00");
      assert("R neraca seimbang", bs.totals.balanced === true);

      const tb = await trialBalance(actor, { from: "2040-01-01", to: "2040-12-31" }, tx);
      assert("R neraca saldo seimbang", tb.totals.balanced === true);

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log(`[test-closing] rollback OK — ${passed} asersi PASS, tidak ada data tersimpan di DB.`);
    return;
  }
}

/** Helper: tutup periode ke status "closed" lalu kembalikan baris periode. */
async function changePeriodStatusClose(actor: AuthContext, tx: Tx, periodId: string) {
  return changePeriodStatus(actor, periodId, { status: "closed" }, tx);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[test-closing] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
