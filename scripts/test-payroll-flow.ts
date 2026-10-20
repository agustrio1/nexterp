import { eq, sql } from "drizzle-orm";

import { chartAccounts, companySettings, journalEntries, payslips, roles, userRoles, users } from "@/db/schema";
import { createEmployee } from "@/modules/hr/employee-service";
import { createFiscalYear } from "@/modules/organization/fiscal-service";
import { createComponent } from "@/modules/payroll/component-service";
import {
  createAdjustment,
  setComponentValue,
  setCompensation,
} from "@/modules/payroll/compensation-service";
import { finalizePeriod, createPeriod } from "@/modules/payroll/period-service";
import { createStatutoryRule } from "@/modules/payroll/statutory-service";
import {
  approveRun,
  calculateRun,
  createRun,
  postRun,
  reverseRun,
} from "@/modules/payroll/run-service";
import { loadGrants, type AuthContext } from "@/server/authz";
import { db } from "@/server/db";

/**
 * Skrip uji Tahap 7E: alur payroll end-to-end (master -> periode -> run ->
 * kalkulasi -> approve (SoD) -> post (jurnal) -> reverse) lengkap dengan jurnal
 * akrual & slip gaji. SELURUH operasi dalam SATU db.transaction dengan throw
 * Rollback — TIDAK ADA data tersimpan di DB.
 *
 * BUTUH migrasi 0025 (tabel payroll). Mesin bersifat KONFIGURATIF: tarif
 * statutory di bawah adalah sintetis dengan source="UJI" (bukan angka regulasi).
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

class Rollback extends Error {}

let passed = 0;
function assert(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "GAGAL"}: ${label}`);
  if (!ok) throw new Error(`Aseri gagal: ${label}`);
  passed += 1;
}

async function expectError(label: string, tx: Tx, expectedCode: string, fn: () => Promise<unknown>) {
  await tx.execute(sql`savepoint sp_err`);
  try {
    await fn();
    await tx.execute(sql`release savepoint sp_err`);
    assert(`${label} (seharusnya ${expectedCode})`, false);
  } catch (error) {
    await tx.execute(sql`rollback to savepoint sp_err`);
    const e = error as { code?: string };
    assert(`${label} = ${expectedCode}`, e.code === expectedCode);
  }
}

async function main() {
  const [u] = await db.select({ id: users.id }).from(users).limit(1);
  if (!u) throw new Error("Belum ada pengguna (jalankan db:seed + db:create-admin).");

  const actorA: AuthContext = { userId: u.id, name: "Operator", email: "operator-uji@example.com", grants: await loadGrants(u.id) };
  const noGrants: AuthContext = { ...actorA, grants: [] };

  // Tahun fiskal + periode akuntansi OPEN agar jurnal payroll dapat diposting.
  // Tanggal jauh di masa depan (2035) agar tidak bentrok dengan data yang ada.
  const PAY_PERIOD_START = "2035-03-01";
  const PAY_PERIOD_END = "2035-03-31";

  try {
    await db.transaction(async (tx) => {
      /* ---------- Prasyarat posting: akun GL payroll + periode akuntansi open ---------- */
      await createFiscalYear(
        actorA,
        { code: "UJIFY2035", startDate: "2035-01-01", endDate: "2035-12-31", includeAdjustmentPeriod: false },
        tx,
      );

      async function addAccount(code: string, name: string, type: "expense" | "liability") {
        const [row] = await tx
          .insert(chartAccounts)
          .values({ code, name, type, isPostable: true, isActive: true, createdBy: actorA.userId, updatedBy: actorA.userId })
          .returning({ id: chartAccounts.id });
        if (!row) throw new Error(`Gagal membuat akun uji ${code}`);
        return row.id;
      }
      const accSalaryExpense = await addAccount("9901", "Beban Gaji Uji", "expense");
      const accBpjsExpense = await addAccount("9902", "Beban Iuran BPJS Uji", "expense");
      const accPayrollPayable = await addAccount("9903", "Utang Gaji Uji", "liability");
      const accPph21 = await addAccount("9904", "Utang PPh 21 Uji", "liability");
      const accBpjs = await addAccount("9905", "Utang Iuran BPJS Uji", "liability");
      const accOtherDed = await addAccount("9906", "Utang Potongan Lain Uji", "liability");

      const settings: { key: string; value: string }[] = [
        { key: "salary_expense_account_id", value: accSalaryExpense },
        { key: "bpjs_expense_account_id", value: accBpjsExpense },
        { key: "payroll_payable_account_id", value: accPayrollPayable },
        { key: "pph21_payable_account_id", value: accPph21 },
        { key: "bpjs_payable_account_id", value: accBpjs },
        { key: "other_deduction_payable_account_id", value: accOtherDed },
      ];
      for (const s of settings) {
        await tx
          .insert(companySettings)
          .values({ key: s.key, value: s.value, updatedBy: actorA.userId })
          .onConflictDoUpdate({ target: companySettings.key, set: { value: s.value } });
      }

      /* ---------- Aktor kedua (pemisahan tugas / SoD) ---------- */
      const [approverUser] = await tx
        .insert(users)
        .values({ name: "Approver", email: "payroll-approver-uji@example.com", emailVerified: true })
        .returning({ id: users.id });
      if (!approverUser) throw new Error("Gagal membuat pengguna approver uji.");
      const [superAdmin] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.code, "super_admin"))
        .limit(1);
      if (!superAdmin) throw new Error("Role super_admin belum ada (jalankan db:seed).");
      await tx.insert(userRoles).values({ userId: approverUser.id, roleId: superAdmin.id });
      // actorB memakai grants yang sama (super_admin) namun userId berbeda -> SoD lolos.
      const actorB: AuthContext = { userId: approverUser.id, name: "Approver", email: "payroll-approver-uji@example.com", grants: actorA.grants };

      /* ---------- Master konfiguratif (source="UJI", sintetis) ---------- */
      const compTunj = await createComponent(
        actorA,
        { code: "UJ-TUNJ", name: "Tunjangan Uji", kind: "earning", basis: "fixed", includeInTaxBase: true, includeInBpjsBase: true },
        tx,
      );
      assert("createComponent id", !!compTunj.id);
      await expectError("komponen tanpa izin", tx, "FORBIDDEN", () =>
        createComponent(noGrants, { code: "UJ-NOPE", name: "Nope Uji", kind: "earning", basis: "fixed", includeInTaxBase: false, includeInBpjsBase: false }, tx),
      );

      // PPh 21 10% atas dasar pajak (employee).
      await createStatutoryRule(
        actorA,
        { code: "UJ-PPH21", kind: "pph21", party: "employee", name: "PPh 21 Uji", rate: "10", source: "UJI", effectiveFrom: "2035-01-01" },
        tx,
      );
      // BPJS JHT 2% pekerja (employee).
      await createStatutoryRule(
        actorA,
        { code: "UJ-JHT-EMP", kind: "bpjs_jht", party: "employee", name: "BPJS JHT Pekerja Uji", rate: "2", source: "UJI", effectiveFrom: "2035-01-01" },
        tx,
      );
      // BPJS JHT 5% pemberi kerja (employer) -> biaya perusahaan.
      await createStatutoryRule(
        actorA,
        { code: "UJ-JHT-APL", kind: "bpjs_jht", party: "employer", name: "BPJS JHT Pemberi Uji", rate: "5", source: "UJI", effectiveFrom: "2035-01-01" },
        tx,
      );

      /* ---------- Karyawan + kompensasi + nilai komponen + penyesuaian ---------- */
      const emp = await createEmployee(
        actorA,
        { code: "UJ-EMP01", firstName: "Karyawan", lastName: "Uji", email: null, dateJoined: "2035-01-01", status: "active" },
        tx,
      );
      await setCompensation(actorA, { employeeId: emp.id, baseSalary: "10000000", effectiveFrom: "2035-01-01" }, tx);
      await setComponentValue(actorA, { employeeId: emp.id, componentId: compTunj.id, amount: "1000000", effectiveFrom: "2035-01-01" }, tx);
      await createAdjustment(actorA, { employeeId: emp.id, kind: "earning", amount: "500000", effectiveFrom: "2035-03-05", notes: "THR Uji" }, tx);
      await createAdjustment(actorA, { employeeId: emp.id, kind: "deduction", amount: "100000", effectiveFrom: "2035-03-05", notes: "Koperasi Uji" }, tx);

      /* ---------- Periode payroll: draft -> finalized ---------- */
      const period = await createPeriod(
        actorA,
        { code: "UJ-PER-203503", name: "Maret 2035", periodStart: PAY_PERIOD_START, periodEnd: PAY_PERIOD_END },
        tx,
      );
      assert("createPeriod status draft", period.status === "draft");
      await finalizePeriod(actorA, period.id, tx);

      /* ---------- Run: create -> (guard approve sebelum calculate) -> calculate ---------- */
      await expectError("buat run tanpa finalisasi", tx, "BUSINESS_RULE", async () => {
        const p2 = await createPeriod(actorA, { code: "UJ-PER-DRAFT", name: "Draft Uji", periodStart: "2035-06-01", periodEnd: "2035-06-30" }, tx);
        await createRun(actorA, { periodId: p2.id }, tx);
      });

      const run = await createRun(actorA, { periodId: period.id }, tx);
      assert("createRun status draft", run.status === "draft");
      await expectError("run duplikat (periode/cabang sama)", tx, "BUSINESS_RULE", () =>
        createRun(actorA, { periodId: period.id }, tx),
      );
      await expectError("approve sebelum calculate", tx, "BUSINESS_RULE", () => approveRun(actorB, run.id, tx));

      const calculated = await calculateRun(actorA, run.id, tx);
      assert("calculate status calculated", calculated.status === "calculated");
      assert("calculate employeeCount = 1", calculated.employeeCount === 1);
      // Ekspektasi mesin (sintetis):
      //   gross = 10.000.000 + 1.000.000 (tunj) + 500.000 (THR) = 11.500.000
      //   taxBase = 11.000.000 -> PPh21 10% = 1.100.000
      //   bpjsBase = 11.000.000 -> JHT pekerja 2% = 220.000; pemberi 5% = 550.000
      //   otherDeduction (Koperasi) = 100.000
      //   totalDeductions = 1.100.000 + 220.000 + 100.000 = 1.420.000
      //   net = 11.500.000 - 1.420.000 = 10.080.000
      assert("run totalEarnings", calculated.totalEarnings === "11500000.00");
      assert("run totalDeductions", calculated.totalDeductions === "1420000.00");
      assert("run totalNet", calculated.totalNet === "10080000.00");
      const item = calculated.items[0];
      assert("item ada", !!item);
      if (item) {
        assert("item gross", item.grossEarnings === "11500000.00");
        assert("item net", item.netPay === "10080000.00");
        const compLabels = item.components.map((c) => c.label);
        assert("item ada baris Gaji Pokok", compLabels.includes("Gaji Pokok"));
        assert("item ada baris PPh 21 Uji", compLabels.includes("PPh 21 Uji"));
        assert("item ada biaya pemberi kerja BPJS", compLabels.includes("BPJS JHT Pemberi Uji (pemberi kerja)"));
      }

      /* ---------- Approve (SoD): pembuat/ penghitung dilarang menyetujui ---------- */
      await expectError("approve oleh pembuat run", tx, "BUSINESS_RULE", () => approveRun(actorA, run.id, tx));
      const approved = await approveRun(actorB, run.id, tx);
      assert("approve status approved", approved.status === "approved");

      /* ---------- Post: jurnal akrual + slip gaji + periode posted ---------- */
      const posted = await postRun(actorB, run.id, tx);
      assert("post status posted", posted.status === "posted");
      assert("post docNo PR-", typeof posted.docNo === "string" && posted.docNo.startsWith("PR-"));
      const jeId = posted.journalEntryId;
      assert("post journalEntryId terisi", !!jeId);
      if (jeId) {
        const [journal] = await tx
          .select({ status: journalEntries.status, totalDebit: journalEntries.totalDebit, totalCredit: journalEntries.totalCredit })
          .from(journalEntries)
          .where(eq(journalEntries.id, jeId))
          .limit(1);
        assert("jurnal posted", journal?.status === "posted");
        assert("jurnal seimbang", journal?.totalDebit === journal?.totalCredit && journal.totalDebit === "12050000.00");
      }

      const slipRows = await tx
        .select({ status: payslips.status, docNo: payslips.docNo, netPay: payslips.netPay })
        .from(payslips)
        .where(eq(payslips.employeeId, emp.id));
      assert("slip diterbitkan 1", slipRows.length === 1);
      assert("slip issued", slipRows[0]?.status === "issued");
      assert("slip netPay", slipRows[0]?.netPay === "10080000.00");
      assert("slip docNo PS-", typeof slipRows[0]?.docNo === "string" && slipRows[0].docNo.startsWith("PS-"));

      /* ---------- Reverse: jurnal dibalik + slip void + status reversed ---------- */
      const reversed = await reverseRun(actorB, run.id, "Koreksi uji", tx);
      assert("reverse status reversed", reversed.status === "reversed");
      const slipAfter = await tx
        .select({ status: payslips.status })
        .from(payslips)
        .where(eq(payslips.employeeId, emp.id));
      assert("slip void pasca-reverse", slipAfter.every((s) => s.status === "void"));

      /* ---------- Guard lifecycle pasca-reverse ---------- */
      await expectError("post ulang run reversed", tx, "BUSINESS_RULE", () => postRun(actorB, run.id, tx));

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log(`[test-payroll-flow] rollback OK — ${passed} asersi PASS, tidak ada data tersimpan di DB.`);
    return;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[test-payroll-flow] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
