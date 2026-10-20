import { and, eq } from "drizzle-orm";

import {
  accountingPeriods,
  bankAccounts,
  chartAccounts,
  companySettings,
  fiscalYears,
  fixedAssets,
  roles,
  userRoles,
  users,
} from "@/db/schema";
import {
  cancelAcquisition,
  createAcquisition,
  postAcquisition,
  reverseAcquisition,
} from "@/modules/assets/acquisition-service";
import { createCategory } from "@/modules/assets/category-service";
import {
  approveRun,
  calculateRun,
  createRun,
  listSchedules,
  postRun,
  reverseRun,
} from "@/modules/assets/depreciation-run-service";
import { createDisposal, postDisposal, reverseDisposal } from "@/modules/assets/disposal-service";
import { createAsset, upsertUsage } from "@/modules/assets/asset-service";
import { assetRegister } from "@/modules/assets/report-service";
import { createFiscalYear } from "@/modules/organization/fiscal-service";
import type { Tx } from "@/modules/assets/_refs";
import { loadGrants, type AuthContext } from "@/server/authz";
import { db } from "@/server/db";

/**
 * Skrip uji Tahap 8B: alur aset tetap end-to-end. FY terisolasi (UJIFY2036),
 * akun GL + setting aset khusus uji, lalu menggerakkan: akuisisi (utang) -> post,
 * run penyusutan tiga metode (garis lurus / saldo menurun / satuan produksi) ->
 * kalkulasi -> approve SoD -> post, pelepasan (laba & rugi) -> post, lalu
 * pembalikan berurutan (pelepasan, run, akuisisi). Semua nominal per metode
 * diajarkan PERSIS. SELURUHNYA dalam SATU transaksi dengan throw Rollback —
 * TIDAK ADA data tersimpan di DB.
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

async function readAsset(tx: Tx, id: string) {
  const [row] = await tx
    .select({
      code: fixedAssets.code,
      cost: fixedAssets.cost,
      accumulated: fixedAssets.accumulatedDepreciation,
      status: fixedAssets.status,
      isActive: fixedAssets.isActive,
    })
    .from(fixedAssets)
    .where(eq(fixedAssets.id, id))
    .limit(1);
  if (!row) throw new Error(`Aset uji ${id} tidak ditemukan.`);
  return row;
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

  try {
    await db.transaction(async (tx) => {
      /* ---------- Prasyarat: FY 2036 (12 periode bulanan open) ---------- */
      await createFiscalYear(
        actorA,
        { code: "UJIFY2036", startDate: "2036-01-01", endDate: "2036-12-31", includeAdjustmentPeriod: false },
        tx,
      );

      /* ---------- Akun GL + setting akun aset ---------- */
      async function addAccount(code: string, name: string, type: "asset" | "liability" | "expense" | "revenue") {
        const [row] = await tx
          .insert(chartAccounts)
          .values({ code, name, type, isPostable: true, isActive: true, createdBy: actorA.userId, updatedBy: actorA.userId })
          .returning({ id: chartAccounts.id });
        if (!row) throw new Error(`Gagal membuat akun uji ${code}`);
        return row.id;
      }
      const accAssetCost = await addAccount("1901", "Aset Tetap Uji", "asset");
      const accAccumDep = await addAccount("1902", "Akumulasi Penyusutan Uji", "asset");
      const accBank = await addAccount("1910", "Bank Uji Aset", "asset");
      const accAssetPayable = await addAccount("2901", "Utang Aset Uji", "liability");
      const accDepExpense = await addAccount("5901", "Beban Penyusutan Uji", "expense");
      const accDisposalLoss = await addAccount("5902", "Rugi Pelepasan Aset Uji", "expense");
      const accDisposalGain = await addAccount("4901", "Laba Pelepasan Aset Uji", "revenue");

      const settings: { key: string; value: string }[] = [
        { key: "asset_cost_account_id", value: accAssetCost },
        { key: "accumulated_depreciation_account_id", value: accAccumDep },
        { key: "depreciation_expense_account_id", value: accDepExpense },
        { key: "asset_payable_account_id", value: accAssetPayable },
        { key: "disposal_loss_account_id", value: accDisposalLoss },
        { key: "disposal_gain_account_id", value: accDisposalGain },
      ];
      for (const s of settings) {
        await tx
          .insert(companySettings)
          .values({ key: s.key, value: s.value, updatedBy: actorA.userId })
          .onConflictDoUpdate({ target: companySettings.key, set: { value: s.value } });
      }

      const [bank] = await tx
        .insert(bankAccounts)
        .values({ code: "UJ-BANK-36", name: "Bank Uji Aset", accountId: accBank, kind: "bank", createdBy: actorA.userId, updatedBy: actorA.userId })
        .returning({ id: bankAccounts.id });
      if (!bank) throw new Error("Gagal membuat rekening bank uji.");

      /* ---------- Aktor kedua (SoD) memakai grants super_admin ---------- */
      const [approverUser] = await tx
        .insert(users)
        .values({ name: "Approver", email: "asset-approver-uji@example.com", emailVerified: true })
        .returning({ id: users.id });
      if (!approverUser) throw new Error("Gagal membuat pengguna approver uji.");
      const [superAdmin] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.code, "super_admin"))
        .limit(1);
      if (!superAdmin) throw new Error("Role super_admin belum ada (jalankan db:seed).");
      await tx.insert(userRoles).values({ userId: approverUser.id, roleId: superAdmin.id });
      const actorB: AuthContext = {
        userId: approverUser.id,
        name: "Approver",
        email: "asset-approver-uji@example.com",
        grants: actorA.grants,
      };

      /* ---------- Kategori + aset (3 metode penyusutan) ---------- */
      const cat = await createCategory(
        actorA,
        { code: "UJAST", name: "Aktiva Uji", depreciationMethod: "straight_line", usefulLifeMonths: 48, residualPercent: "0" },
        tx,
      );

      // A1: garis lurus — dibuat draft 9.000.000 lalu akuisisi utang 3.000.000 -> 12.000.000.
      const a1 = await createAsset(
        actorA,
        { code: "UJ-A1", name: "Mesin Uji Satu", categoryId: cat.id, inServiceDate: "2036-03-01", cost: "9000000", status: "draft" },
        tx,
      );
      // A2: saldo menurun 20%/periode atas nilai buku 10.000.000.
      const a2 = await createAsset(
        actorA,
        { code: "UJ-A2", name: "Mobil Uji Dua", categoryId: cat.id, inServiceDate: "2036-03-01", cost: "10000000", depreciationMethod: "declining_balance", decliningRatePercent: "20", status: "active" },
        tx,
      );
      // A3: satuan produksi — basis susut 5.000.000 - residu 500.000, total 10.000 jam.
      const a3 = await createAsset(
        actorA,
        { code: "UJ-A3", name: "Alat Uji Tiga", categoryId: cat.id, inServiceDate: "2036-03-01", cost: "5000000", depreciationMethod: "units_of_production", residualValue: "500000", totalUnits: 10000, status: "active" },
        tx,
      );
      await upsertUsage(actorA, a3.id, { periodKey: "2036-03", units: 2000 }, tx);

      /* ---------- Akuisisi A1 (sumber utang) -> post ---------- */
      const acq = await createAcquisition(
        actorA,
        { assetId: a1.id, acquisitionDate: "2036-03-10", amount: "3000000", fundingSource: "payable", notes: "Kredit mesin uji" },
        tx,
      );
      assert("akuisisi awal draft", acq.status === "draft" && acq.docNo === null);
      await expectFail("posting akuisisi oleh actor tanpa izin post", async () => {
        const noPost: AuthContext = { ...actorA, grants: [] };
        await postAcquisition(noPost, acq.id, tx);
      });
      const acqPosted = await postAcquisition(actorA, acq.id, tx);
      assert("akuisisi posted", acqPosted.status === "posted" && acqPosted.docNo !== null && acqPosted.journalEntryId !== null);
      const a1AfterAcq = await readAsset(tx, a1.id);
      assert("biaya A1 naik 12.000.000", a1AfterAcq.cost === "12000000.00");
      assert("A1 otomatis aktif", a1AfterAcq.status === "active");

      /* ---------- Batal akuisisi draft ---------- */
      const acqBatal = await createAcquisition(
        actorA,
        { assetId: a2.id, acquisitionDate: "2036-03-11", amount: "100", fundingSource: "bank", bankAccountId: bank.id },
        tx,
      );
      const acqCancelled = await cancelAcquisition(actorA, acqBatal.id, "Batal uji", tx);
      assert("akuisisi draft dibatalkan", acqCancelled.status === "cancelled" && acqCancelled.docNo === null);
      await expectFail("membatalkan akuisisi posted", () => cancelAcquisition(actorA, acq.id, "Harusnya gagal", tx));

      /* ---------- Run penyusutan Maret 2036 ---------- */
      const [period] = await tx
        .select({ id: accountingPeriods.id })
        .from(accountingPeriods)
        .innerJoin(fiscalYears, eq(fiscalYears.id, accountingPeriods.fiscalYearId))
        .where(and(eq(fiscalYears.code, "UJIFY2036"), eq(accountingPeriods.periodNo, 3)))
        .limit(1);
      if (!period) throw new Error("Periode Maret 2036 tidak ditemukan.");

      const run = await createRun(actorA, { periodId: period.id }, tx);
      const calculated = await calculateRun(actorA, run.id, tx);
      assert("run calculated", calculated.status === "calculated");
      assert("run 3 aset", calculated.items.length === 3 && calculated.assetCount === 3);
      assert("run total 3.150.000", calculated.totalDepreciation === "3150000.00");

      const byCode = new Map(calculated.items.map((i) => [i.assetCode, i]));
      assert("garis lurus UJ-A1 = 250.000", byCode.get("UJ-A1")?.depreciationAmount === "250000.00");
      assert("saldo menurun UJ-A2 = 2.000.000", byCode.get("UJ-A2")?.depreciationAmount === "2000000.00");
      assert("satuan produksi UJ-A3 = 900.000", byCode.get("UJ-A3")?.depreciationAmount === "900000.00");
      assert("nilai buku UJ-A1 = 11.750.000", byCode.get("UJ-A1")?.closingBookValue === "11750000.00");

      await expectFail("approve oleh pembuat run (SoD)", () => approveRun(actorA, run.id, tx));
      await expectFail("post sebelum approve", () => postRun(actorB, run.id, tx));
      const approved = await approveRun(actorB, run.id, tx);
      assert("run approved", approved.status === "approved");
      const posted = await postRun(actorB, run.id, tx);
      assert("run posted", posted.status === "posted" && posted.docNo !== null && posted.journalEntryId !== null);
      await expectFail("post run ganda", () => postRun(actorB, run.id, tx));

      const a1AfterRun = await readAsset(tx, a1.id);
      const a2AfterRun = await readAsset(tx, a2.id);
      const a3AfterRun = await readAsset(tx, a3.id);
      assert("akumulasi A1 = 250.000", a1AfterRun.accumulated === "250000.00");
      assert("akumulasi A2 = 2.000.000", a2AfterRun.accumulated === "2000000.00");
      assert("akumulasi A3 = 900.000", a3AfterRun.accumulated === "900000.00");

      const schedules1 = await listSchedules(actorA, a1.id, tx);
      assert("jadwal A1 2036-03 booked", schedules1.some((s) => s.periodKey === "2036-03" && s.isBooked));

      /* ---------- Register aset ---------- */
      const register = await assetRegister(actorA, {}, tx);
      const regA1 = register.rows.find((r) => r.code === "UJ-A1");
      assert("register NBV A1 = 11.750.000", regA1?.netBookValue === "11750000.00");
      assert("register mencakup UJ-A1..A3", register.rows.some((r) => r.code === "UJ-A3") && register.count >= 3);

      /* ---------- Pelepasan: A2 laba, A3 rugi ---------- */
      // A2: NBV 8.000.000, hasil 9.000.000 -> laba 1.000.000.
      const dispGain = await createDisposal(
        actorA,
        { assetId: a2.id, disposalDate: "2036-03-20", proceedsAmount: "9000000", bankAccountId: bank.id },
        tx,
      );
      const dispGainPosted = await postDisposal(actorA, dispGain.id, tx);
      assert("pelepasan laba posted", dispGainPosted.status === "posted" && dispGainPosted.docNo !== null);
      assert("laba pelepasan A2 = 1.000.000", dispGainPosted.gainAmount === "1000000.00" && dispGainPosted.lossAmount === "0.00");
      assert("costRemoved A2 = 10.000.000", dispGainPosted.costRemoved === "10000000.00");
      assert("accumRemoved A2 = 2.000.000", dispGainPosted.accumulatedRemoved === "2000000.00");
      const a2Disposed = await readAsset(tx, a2.id);
      assert("A2 status disposed", a2Disposed.status === "disposed" && a2Disposed.isActive === false);

      // A3: NBV 4.100.000, hasil 3.000.000 -> rugi 1.100.000.
      const dispLoss = await createDisposal(
        actorA,
        { assetId: a3.id, disposalDate: "2036-03-21", proceedsAmount: "3000000", bankAccountId: bank.id },
        tx,
      );
      const dispLossPosted = await postDisposal(actorA, dispLoss.id, tx);
      assert("rugi pelepasan A3 = 1.100.000", dispLossPosted.lossAmount === "1100000.00" && dispLossPosted.gainAmount === "0.00");

      /* ---------- Pembalikan berurutan: pelepasan -> run -> akuisisi ---------- */
      const dispGainRev = await reverseDisposal(actorB, dispGain.id, "Koreksi uji laba", tx);
      assert("pelepasan laba reversed", dispGainRev.status === "reversed");
      const a2Back = await readAsset(tx, a2.id);
      assert("A2 kembali active", a2Back.status === "active" && a2Back.isActive === true);
      await reverseDisposal(actorB, dispLoss.id, "Koreksi uji rugi", tx);

      const runReversed = await reverseRun(actorB, run.id, "Koreksi uji run", tx);
      assert("run reversed", runReversed.status === "reversed");
      const a1AfterRev = await readAsset(tx, a1.id);
      assert("akumulasi A1 kembali nol", a1AfterRev.accumulated === "0.00");
      const schedulesRev = await listSchedules(actorA, a1.id, tx);
      assert("jadwal A1 tak lagi booked", schedulesRev.every((s) => !s.isBooked));
      await expectFail("reverse run ganda", () => reverseRun(actorB, run.id, "Harusnya gagal", tx));

      const acqReversed = await reverseAcquisition(actorB, acq.id, "Koreksi uji akuisisi", tx);
      assert("akuisisi reversed", acqReversed.status === "reversed");
      const a1Final = await readAsset(tx, a1.id);
      assert("biaya A1 kembali 9.000.000", a1Final.cost === "9000000.00");

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log(`[test-asset-flow] rollback OK — ${passed} asersi PASS, tidak ada data tersimpan di DB.`);
    return;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[test-asset-flow] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
