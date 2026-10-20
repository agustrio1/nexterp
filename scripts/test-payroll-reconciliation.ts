import { eq } from "drizzle-orm";

import { chartAccounts, companySettings, roles, userRoles, users } from "@/db/schema";
import { createEmployee } from "@/modules/hr/employee-service";
import { attendanceSummary, headcountByDepartment, leaveBalancesReport } from "@/modules/hr/report-service";
import { createFiscalYear } from "@/modules/organization/fiscal-service";
import { createComponent } from "@/modules/payroll/component-service";
import {
  createAdjustment,
  setComponentValue,
  setCompensation,
} from "@/modules/payroll/compensation-service";
import { createPeriod, finalizePeriod } from "@/modules/payroll/period-service";
import {
  payrollCostByDepartment,
  payrollGlReconciliation,
  payslipRegister,
} from "@/modules/payroll/report-service";
import { createStatutoryRule } from "@/modules/payroll/statutory-service";
import { approveRun, calculateRun, createRun, postRun, reverseRun } from "@/modules/payroll/run-service";
import { loadGrants, type AuthContext } from "@/server/authz";
import { db } from "@/server/db";

/**
 * Skrip uji Tahap 7F: laporan & rekonsiliasi payroll. Membangun satu run posted
 * (setup identik test-payroll-flow), lalu memverifikasi invarian subledger↔GL:
 * tiap baris rekonsiliasi `matched` saat posted, dan tetap `matched` (nol di kedua
 * sisi) pasca-reverse. Juga meng exercised payrollCostByDepartment, payslipRegister,
 * serta laporan HR (headcount/absensi/saldo cuti). SELURUHNYA dalam SATU transaksi
 * dengan throw Rollback — TIDAK ADA data tersimpan di DB.
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

      /* ---------- Aktor kedua (SoD) memakai grants super_admin ---------- */
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
      const actorB: AuthContext = {
        userId: approverUser.id,
        name: "Approver",
        email: "payroll-approver-uji@example.com",
        grants: actorA.grants,
      };

      /* ---------- Master + karyawan + kompensasi ---------- */
      const compTunj = await createComponent(
        actorA,
        { code: "UJ-TUNJ", name: "Tunjangan Uji", kind: "earning", basis: "fixed", includeInTaxBase: true, includeInBpjsBase: true },
        tx,
      );
      await createStatutoryRule(actorA, { code: "UJ-PPH21", kind: "pph21", party: "employee", name: "PPh 21 Uji", rate: "10", source: "UJI", effectiveFrom: "2035-01-01" }, tx);
      await createStatutoryRule(actorA, { code: "UJ-JHT-EMP", kind: "bpjs_jht", party: "employee", name: "BPJS JHT Pekerja Uji", rate: "2", source: "UJI", effectiveFrom: "2035-01-01" }, tx);
      await createStatutoryRule(actorA, { code: "UJ-JHT-APL", kind: "bpjs_jht", party: "employer", name: "BPJS JHT Pemberi Uji", rate: "5", source: "UJI", effectiveFrom: "2035-01-01" }, tx);

      const emp = await createEmployee(
        actorA,
        { code: "UJ-EMP01", firstName: "Karyawan", lastName: "Uji", email: null, dateJoined: "2035-01-01", status: "active" },
        tx,
      );
      await setCompensation(actorA, { employeeId: emp.id, baseSalary: "10000000", effectiveFrom: "2035-01-01" }, tx);
      await setComponentValue(actorA, { employeeId: emp.id, componentId: compTunj.id, amount: "1000000", effectiveFrom: "2035-01-01" }, tx);
      await createAdjustment(actorA, { employeeId: emp.id, kind: "earning", amount: "500000", effectiveFrom: "2035-03-05", notes: "THR Uji" }, tx);
      await createAdjustment(actorA, { employeeId: emp.id, kind: "deduction", amount: "100000", effectiveFrom: "2035-03-05", notes: "Koperasi Uji" }, tx);

      const period = await createPeriod(
        actorA,
        { code: "UJ-PER-203503", name: "Maret 2035", periodStart: "2035-03-01", periodEnd: "2035-03-31" },
        tx,
      );
      await finalizePeriod(actorA, period.id, tx);

      const run = await createRun(actorA, { periodId: period.id }, tx);
      await calculateRun(actorA, run.id, tx);
      await approveRun(actorB, run.id, tx);
      const posted = await postRun(actorB, run.id, tx);
      assert("run posted", posted.status === "posted");

      /* ---------- Rekonsiliasi subledger↔GL (saat posted) ---------- */
      const recon = await payrollGlReconciliation(actorA, {}, tx);
      assert("recon balanced", recon.balanced === true);
      assert("recon semua baris matched", recon.lines.every((l) => l.matched));
      assert("recon ada baris potongan lain", recon.lines.some((l) => l.label.includes("potongan lain")));
      assert("recon postedGross", recon.inputs.postedGross === "11500000.00");
      assert("recon postedNet", recon.inputs.postedNet === "10080000.00");
      assert("recon tax", recon.inputs.tax === "1100000.00");
      assert("recon bpjsEmployee", recon.inputs.bpjsEmployee === "220000.00");
      assert("recon bpjsEmployer", recon.inputs.bpjsEmployer === "550000.00");
      assert("recon otherDeduction", recon.inputs.otherDeduction === "100000.00");

      /* ---------- Beban gaji per departemen ---------- */
      const byDept = await payrollCostByDepartment(actorA, {}, tx);
      assert("byDept totals gross", byDept.totals.grossEarnings === "11500000.00");
      assert("byDept totals net", byDept.totals.netPay === "10080000.00");
      assert("byDept totals tax", byDept.totals.tax === "1100000.00");
      // totalCost = gross + bpjs pemberi kerja = 11.500.000 + 550.000
      assert("byDept totals totalCost", byDept.totals.totalCost === "12050000.00");
      assert("byDept employeeCount", byDept.totals.employeeCount === 1);

      /* ---------- Daftar slip ---------- */
      const register = await payslipRegister(actorA, { employeeId: emp.id }, tx);
      assert("register count 1", register.count === 1);
      assert("register totalNet", register.totalNet === "10080000.00");

      /* ---------- Laporan HR ---------- */
      const headcount = await headcountByDepartment(actorA, {}, tx);
      assert("headcount >= 1", headcount.totalHeadcount >= 1);
      const attendance = await attendanceSummary(actorA, {}, tx);
      assert("attendance (tanpa data) records 0", attendance.totals.records === 0);
      const leave = await leaveBalancesReport(actorA, { year: 2035 }, tx);
      assert("leave balances (tanpa data) kosong", leave.rows.length === 0);

      /* ---------- Reverse: invarian tetap matched (nol di kedua sisi) ---------- */
      await reverseRun(actorB, run.id, "Koreksi uji", tx);
      const reconAfter = await payrollGlReconciliation(actorA, {}, tx);
      assert("recon pasca-reverse balanced", reconAfter.balanced === true);
      assert("recon pasca-reverse matched", reconAfter.lines.every((l) => l.matched));
      assert("recon pasca-reverse gross nol", reconAfter.inputs.postedGross === "0.00");

      const byDeptAfter = await payrollCostByDepartment(actorA, {}, tx);
      assert("byDept pasca-reverse gross nol", byDeptAfter.totals.grossEarnings === "0.00");

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log(`[test-payroll-reconciliation] rollback OK — ${passed} asersi PASS, tidak ada data tersimpan di DB.`);
    return;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[test-payroll-reconciliation] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
