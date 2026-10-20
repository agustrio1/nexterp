import { and, eq } from "drizzle-orm";

import {
  accountingPeriods,
  chartAccounts,
  companySettings,
  fiscalYears,
  roles,
  userRoles,
  users,
} from "@/db/schema";
import { createAcquisition, postAcquisition, reverseAcquisition } from "@/modules/assets/acquisition-service";
import { createCategory } from "@/modules/assets/category-service";
import { approveRun, calculateRun, createRun, postRun, reverseRun } from "@/modules/assets/depreciation-run-service";
import { createAsset } from "@/modules/assets/asset-service";
import { assetGlReconciliation } from "@/modules/assets/report-service";
import { createFiscalYear } from "@/modules/organization/fiscal-service";
import { createSystemDraft, postJournal } from "@/modules/accounting/journal-service";
import { loadGrants, type AuthContext } from "@/server/authz";
import { db } from "@/server/db";

/**
 * Skrip uji Tahap 8B: invarian rekonsiliasi subledger<->GL aset tetap.
 * Membangun biaya awal via jurnal saldo awal (postJournal inti) supaya register
 * dan GL konsisten sejak nol, lalu menambah biaya lewat akuisisi posted dan
 * akumulasi/ beban lewat run penyusutan posted. Di TIAP tahap semua baris
 * rekonsiliasi harus `matched`; pasca-reverse run akumulasi & beban nol di kedua
 * sisi; pasca-reverse akuisisi kembali ke posisi saldo awal. SELURUHNYA dalam
 * SATU transaksi dengan throw Rollback — TIDAK ADA data tersimpan di DB.
 */

class Rollback extends Error {}

let passed = 0;
function assert(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "GAGAL"}: ${label}`);
  if (!ok) throw new Error(`Aseri gagal: ${label}`);
  passed += 1;
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
      /* ---------- Prasyarat: FY 2036 + akun GL uji + setting aset ---------- */
      await createFiscalYear(
        actorA,
        { code: "UJIFY2036", startDate: "2036-01-01", endDate: "2036-12-31", includeAdjustmentPeriod: false },
        tx,
      );

      async function addAccount(code: string, name: string, type: "asset" | "liability" | "equity" | "expense") {
        const [row] = await tx
          .insert(chartAccounts)
          .values({ code, name, type, isPostable: true, isActive: true, createdBy: actorA.userId, updatedBy: actorA.userId })
          .returning({ id: chartAccounts.id });
        if (!row) throw new Error(`Gagal membuat akun uji ${code}`);
        return row.id;
      }
      const accAssetCost = await addAccount("1901", "Aset Tetap Recon Uji", "asset");
      const accAccumDep = await addAccount("1902", "Akumulasi Penyusutan Recon Uji", "asset");
      const accAssetPayable = await addAccount("2901", "Utang Aset Recon Uji", "liability");
      const accOpeningEquity = await addAccount("3901", "Ekuitas Saldo Awal Recon Uji", "equity");
      const accDepExpense = await addAccount("5901", "Beban Penyusutan Recon Uji", "expense");

      const settings: { key: string; value: string }[] = [
        { key: "asset_cost_account_id", value: accAssetCost },
        { key: "accumulated_depreciation_account_id", value: accAccumDep },
        { key: "depreciation_expense_account_id", value: accDepExpense },
        { key: "asset_payable_account_id", value: accAssetPayable },
      ];
      for (const s of settings) {
        await tx
          .insert(companySettings)
          .values({ key: s.key, value: s.value, updatedBy: actorA.userId })
          .onConflictDoUpdate({ target: companySettings.key, set: { value: s.value } });
      }

      /* ---------- Aktor kedua (SoD) ---------- */
      const [approverUser] = await tx
        .insert(users)
        .values({ name: "Approver", email: "asset-recon-approver-uji@example.com", emailVerified: true })
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
        email: "asset-recon-approver-uji@example.com",
        grants: actorA.grants,
      };

      /* ---------- Kategori + aset + jurnal saldo awal 4.000.000 ---------- */
      const cat = await createCategory(
        actorA,
        { code: "UJRK", name: "Recon Uji", depreciationMethod: "straight_line", usefulLifeMonths: 60, residualPercent: "0" },
        tx,
      );
      const asset = await createAsset(
        actorA,
        { code: "UJ-R1", name: "Aset Recon Satu", categoryId: cat.id, inServiceDate: "2036-03-01", cost: "4000000", status: "active" },
        tx,
      );

      const openingDraft = await createSystemDraft(tx, actorA, {
        entryDate: "2036-03-01",
        description: "Saldo awal aset tetap uji rekonsiliasi",
        lines: [
          { accountId: accAssetCost, side: "debit", amount: "4000000.00" },
          { accountId: accOpeningEquity, side: "credit", amount: "4000000.00" },
        ],
        sourceType: "manual",
        sourceId: "00000000-0000-4000-8000-000000002036",
        sourceEvent: "post",
        idempotencyKey: "asset_recon_uji_opening_2036",
      });
      await postJournal(actorA, openingDraft.id, tx);

      /* ---------- Rekonsiliasi #1: hanya saldo awal ---------- */
      const recon1 = await assetGlReconciliation(actorA, {}, tx);
      assert("recon#1 balanced", recon1.balanced === true);
      assert("recon#1 semua baris matched", recon1.lines.every((l) => l.matched));
      assert("recon#1 subledger cost 4.000.000", recon1.inputs.subledgerCost === "4000000.00");
      assert("recon#1 GL cost 4.000.000", recon1.lines[0]?.gl === "4000000.00");
      assert("recon#1 akumulasi nol", recon1.lines[1]?.subledger === "0.00" && recon1.lines[1]?.gl === "0.00");

      /* ---------- Akuisisi posted +8.000.000 -> rekonsiliasi #2 ---------- */
      const acq = await createAcquisition(
        actorA,
        { assetId: asset.id, acquisitionDate: "2036-03-10", amount: "8000000", fundingSource: "payable" },
        tx,
      );
      await postAcquisition(actorA, acq.id, tx);

      const recon2 = await assetGlReconciliation(actorA, {}, tx);
      assert("recon#2 balanced", recon2.balanced === true);
      assert("recon#2 subledger cost 12.000.000", recon2.inputs.subledgerCost === "12000000.00");
      assert("recon#2 GL cost 12.000.000", recon2.lines[0]?.gl === "12000000.00" && recon2.lines[0]?.matched);

      /* ---------- Run penyusutan Maret (12.000.000/60 = 200.000) -> #3 ---------- */
      const [period] = await tx
        .select({ id: accountingPeriods.id })
        .from(accountingPeriods)
        .innerJoin(fiscalYears, eq(fiscalYears.id, accountingPeriods.fiscalYearId))
        .where(and(eq(fiscalYears.code, "UJIFY2036"), eq(accountingPeriods.periodNo, 3)))
        .limit(1);
      if (!period) throw new Error("Periode Maret 2036 tidak ditemukan.");

      const run = await createRun(actorA, { periodId: period.id }, tx);
      const calculated = await calculateRun(actorA, run.id, tx);
      assert("run menghitung 200.000", calculated.totalDepreciation === "200000.00");
      await approveRun(actorB, run.id, tx);
      await postRun(actorB, run.id, tx);

      const recon3 = await assetGlReconciliation(actorA, {}, tx);
      assert("recon#3 balanced", recon3.balanced === true);
      assert("recon#3 matched semua", recon3.lines.every((l) => l.matched));
      assert("recon#3 akumulasi 200.000", recon3.lines[1]?.subledger === "200000.00" && recon3.lines[1]?.gl === "200000.00");
      assert("recon#3 beban 200.000", recon3.lines[2]?.subledger === "200000.00" && recon3.lines[2]?.gl === "200000.00");
      assert("recon#3 NBV subledger 11.800.000", recon3.inputs.subledgerNetBook === "11800000.00");

      /* ---------- Reverse run -> akumulasi & beban nol di kedua sisi ---------- */
      await reverseRun(actorB, run.id, "Koreksi uji recon", tx);
      const recon4 = await assetGlReconciliation(actorA, {}, tx);
      assert("recon#4 balanced", recon4.balanced === true);
      assert("recon#4 matched semua", recon4.lines.every((l) => l.matched));
      assert("recon#4 akumulasi nol", recon4.lines[1]?.subledger === "0.00" && recon4.lines[1]?.gl === "0.00");
      assert("recon#4 beban nol", recon4.lines[2]?.subledger === "0.00" && recon4.lines[2]?.gl === "0.00");
      assert("recon#4 cost tetap 12.000.000", recon4.lines[0]?.subledger === "12000000.00" && recon4.lines[0]?.matched);

      /* ---------- Reverse akuisisi -> kembali ke posisi saldo awal ---------- */
      await reverseAcquisition(actorB, acq.id, "Koreksi uji akuisisi", tx);
      const recon5 = await assetGlReconciliation(actorA, {}, tx);
      assert("recon#5 balanced", recon5.balanced === true);
      assert("recon#5 matched semua", recon5.lines.every((l) => l.matched));
      assert("recon#5 cost 4.000.000", recon5.inputs.subledgerCost === "4000000.00" && recon5.lines[0]?.gl === "4000000.00");

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log(`[test-asset-reconciliation] rollback OK — ${passed} asersi PASS, tidak ada data tersimpan di DB.`);
    return;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[test-asset-reconciliation] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
