import { and, asc, eq, inArray, sql } from "drizzle-orm";

import {
  departments,
  employees,
  journalEntries,
  journalEntryLines,
  payslips,
  payrollRunItemComponents,
  payrollRunItems,
  payrollRuns,
  statutoryRules,
} from "@/db/schema";
import type {
  PayrollCostByDepartmentQuery,
  PayrollReconciliationQuery,
  PayslipRegisterQuery,
} from "@/modules/payroll/report-schemas";
import { assertCan, type Reader, type Tx } from "@/modules/payroll/_refs";
import {
  resolveOtherDeductionAccountId,
  resolvePayrollAccountIds,
} from "@/modules/payroll/payroll-account-config";
import { cmp, dec, toDb, type Money } from "@/lib/money";
import type { AuthContext } from "@/server/authz";
import { db } from "@/server/db";

/**
 * Laporan payroll (Tahap 7F), read-only: beban gaji per departemen, daftar slip,
 * dan rekonsiliasi subledger↔GL (invarian mirror AR/AP). Sumber kebenaran akuntansi
 * tetap GL (jurnal posted+reversed); subledger diambil dari run berstatus posted.
 */

const DP = 2;
const LEDGER_STATUSES = ["posted", "reversed"] as const;

/** Run yang dihitung untuk subledger: hanya `posted` (reversed sudah dinet GL-nya). */
const POSTED = "posted";

type Basis = { party?: string };

/* --------------------- Beban gaji per departemen ------------------- */

export async function payrollCostByDepartment(
  actor: AuthContext,
  query: PayrollCostByDepartmentQuery,
  externalTx?: Tx,
) {
  assertCan(actor, "payroll.reports.read");
  const reader = externalTx ?? db;

  const runFilter = and(
    eq(payrollRuns.status, POSTED),
    query.periodId === undefined ? undefined : eq(payrollRuns.periodId, query.periodId),
    query.branchId === undefined ? undefined : eq(payrollRuns.branchId, query.branchId),
  );

  const itemRows = await reader
    .select({
      employeeId: payrollRunItems.employeeId,
      departmentId: employees.departmentId,
      departmentCode: departments.code,
      departmentName: departments.name,
      gross: payrollRunItems.grossEarnings,
      deductions: payrollRunItems.totalDeductions,
      net: payrollRunItems.netPay,
    })
    .from(payrollRunItems)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunItems.runId))
    .innerJoin(employees, eq(employees.id, payrollRunItems.employeeId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(runFilter);

  const compRows = await reader
    .select({
      departmentId: employees.departmentId,
      amount: payrollRunItemComponents.amount,
      ruleKind: statutoryRules.kind,
      basis: payrollRunItemComponents.basisSnapshot,
    })
    .from(payrollRunItemComponents)
    .innerJoin(payrollRunItems, eq(payrollRunItems.id, payrollRunItemComponents.runItemId))
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunItems.runId))
    .innerJoin(employees, eq(employees.id, payrollRunItems.employeeId))
    .leftJoin(statutoryRules, eq(statutoryRules.id, payrollRunItemComponents.statutoryRuleId))
    .where(and(eq(payrollRuns.status, POSTED), eq(payrollRunItemComponents.kind, "deduction")));

  interface DeptAgg {
    departmentId: string | null;
    departmentCode: string | null;
    departmentName: string | null;
    employees: Set<string>;
    gross: Money;
    deductions: Money;
    net: Money;
    tax: Money;
    bpjsEmployee: Money;
    bpjsEmployer: Money;
    otherDeduction: Money;
  }
  const byDept = new Map<string, DeptAgg>();
  const keyFor = (id: string | null) => id ?? "__none__";
  const ensure = (id: string | null, code: string | null, name: string | null): DeptAgg => {
    const key = keyFor(id);
    let agg = byDept.get(key);
    if (!agg) {
      agg = {
        departmentId: id,
        departmentCode: code,
        departmentName: name,
        employees: new Set(),
        gross: dec(0),
        deductions: dec(0),
        net: dec(0),
        tax: dec(0),
        bpjsEmployee: dec(0),
        bpjsEmployer: dec(0),
        otherDeduction: dec(0),
      };
      byDept.set(key, agg);
    }
    if (code && !agg.departmentCode) {
      agg.departmentCode = code;
      agg.departmentName = name;
    }
    return agg;
  };

  for (const r of itemRows) {
    const agg = ensure(r.departmentId, r.departmentCode, r.departmentName);
    agg.employees.add(r.employeeId);
    agg.gross = agg.gross.plus(dec(r.gross));
    agg.deductions = agg.deductions.plus(dec(r.deductions));
    agg.net = agg.net.plus(dec(r.net));
  }
  for (const c of compRows) {
    const agg = ensure(c.departmentId, null, null);
    const party = (c.basis as Basis | null)?.party;
    const amt = dec(c.amount);
    if (party === "employer") {
      agg.bpjsEmployer = agg.bpjsEmployer.plus(amt);
    } else if (c.ruleKind === "pph21") {
      agg.tax = agg.tax.plus(amt);
    } else if (c.ruleKind != null && c.ruleKind.startsWith("bpjs_")) {
      agg.bpjsEmployee = agg.bpjsEmployee.plus(amt);
    } else {
      agg.otherDeduction = agg.otherDeduction.plus(amt);
    }
  }

  const rows = [...byDept.values()]
    .sort((a, b) => {
      const ac = a.departmentCode ?? "";
      const bc = b.departmentCode ?? "";
      return ac < bc ? -1 : ac > bc ? 1 : 0;
    })
    .map((agg) => ({
      departmentId: agg.departmentId,
      departmentCode: agg.departmentCode,
      departmentName: agg.departmentName,
      employeeCount: agg.employees.size,
      grossEarnings: toDb(agg.gross, DP),
      totalDeductions: toDb(agg.deductions, DP),
      netPay: toDb(agg.net, DP),
      tax: toDb(agg.tax, DP),
      bpjsEmployee: toDb(agg.bpjsEmployee, DP),
      bpjsEmployer: toDb(agg.bpjsEmployer, DP),
      otherDeduction: toDb(agg.otherDeduction, DP),
      salaryExpense: toDb(agg.gross, DP),
      totalCost: toDb(agg.gross.plus(agg.bpjsEmployer), DP),
    }));

  const sumField = (key: "grossEarnings" | "netPay" | "tax" | "totalCost") =>
    toDb(rows.reduce((acc: Money, r) => acc.plus(dec(r[key])), dec(0)), DP);

  return {
    periodId: query.periodId ?? null,
    branchId: query.branchId ?? null,
    totals: {
      employeeCount: rows.reduce((a, r) => a + r.employeeCount, 0),
      grossEarnings: sumField("grossEarnings"),
      netPay: sumField("netPay"),
      tax: sumField("tax"),
      totalCost: sumField("totalCost"),
    },
    rows,
  };
}

/* --------------------------- Daftar slip ---------------------------- */

export async function payslipRegister(
  actor: AuthContext,
  query: PayslipRegisterQuery,
  externalTx?: Tx,
) {
  assertCan(actor, "payroll.reports.read");
  const reader = externalTx ?? db;

  const rows = await reader
    .select({
      id: payslips.id,
      docNo: payslips.docNo,
      runItemId: payslips.runItemId,
      employeeId: payslips.employeeId,
      employeeCode: employees.code,
      employeeName: sql<string>`trim(coalesce(${employees.firstName}, '') || ' ' || coalesce(${employees.lastName}, ''))`,
      periodLabel: payslips.periodLabel,
      grossEarnings: payslips.grossEarnings,
      totalDeductions: payslips.totalDeductions,
      netPay: payslips.netPay,
      status: payslips.status,
      runId: payrollRunItems.runId,
    })
    .from(payslips)
    .innerJoin(employees, eq(employees.id, payslips.employeeId))
    .innerJoin(payrollRunItems, eq(payrollRunItems.id, payslips.runItemId))
    .where(
      and(
        query.employeeId === undefined ? undefined : eq(payslips.employeeId, query.employeeId),
        query.runId === undefined ? undefined : eq(payrollRunItems.runId, query.runId),
      ),
    )
    .orderBy(asc(payslips.docNo));

  const sumNet = toDb(rows.reduce((a: Money, r) => a.plus(dec(r.netPay)), dec(0)), DP);
  return { runId: query.runId ?? null, employeeId: query.employeeId ?? null, count: rows.length, totalNet: sumNet, rows };
}

/* -------------------- Rekonsiliasi subledger ↔ GL ------------------- */

export async function payrollGlReconciliation(
  actor: AuthContext,
  _query: PayrollReconciliationQuery,
  externalTx?: Tx,
) {
  assertCan(actor, "payroll.reports.read");
  const reader = externalTx ?? db;
  const accounts = await resolvePayrollAccountIds(reader);
  const otherAccountId = await resolveOtherDeductionAccountId(reader, false);

  // ---- Subledger (run posted) ----
  const [grossAgg] = await reader
    .select({
      gross: sql<string>`coalesce(sum(${payrollRunItems.grossEarnings}), 0)::numeric(18,2)`,
      net: sql<string>`coalesce(sum(${payrollRunItems.netPay}), 0)::numeric(18,2)`,
    })
    .from(payrollRunItems)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunItems.runId))
    .where(eq(payrollRuns.status, POSTED));

  const compRows = await reader
    .select({
      amount: payrollRunItemComponents.amount,
      ruleKind: statutoryRules.kind,
      basis: payrollRunItemComponents.basisSnapshot,
    })
    .from(payrollRunItemComponents)
    .innerJoin(payrollRunItems, eq(payrollRunItems.id, payrollRunItemComponents.runItemId))
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunItems.runId))
    .leftJoin(statutoryRules, eq(statutoryRules.id, payrollRunItemComponents.statutoryRuleId))
    .where(and(eq(payrollRuns.status, POSTED), eq(payrollRunItemComponents.kind, "deduction")));

  let tax = dec(0);
  let bpjsEmployee = dec(0);
  let bpjsEmployer = dec(0);
  let otherDeduction = dec(0);
  for (const c of compRows) {
    const party = (c.basis as Basis | null)?.party;
    const amt = dec(c.amount);
    if (party === "employer") bpjsEmployer = bpjsEmployer.plus(amt);
    else if (c.ruleKind === "pph21") tax = tax.plus(amt);
    else if (c.ruleKind != null && c.ruleKind.startsWith("bpjs_")) bpjsEmployee = bpjsEmployee.plus(amt);
    else otherDeduction = otherDeduction.plus(amt);
  }

  const sub = {
    salaryExpense: dec(grossAgg?.gross ?? "0"),
    bpjsExpense: bpjsEmployer,
    payrollPayable: dec(grossAgg?.net ?? "0"),
    pph21Payable: tax,
    bpjsPayable: bpjsEmployee.plus(bpjsEmployer),
    otherDeductionPayable: otherDeduction,
  };

  // ---- GL (jurnal posted+reversed) ----
  const salaryExpenseGl = await glNet(reader, accounts.salaryExpenseAccountId, "debit");
  const bpjsExpenseGl = await glNet(reader, accounts.bpjsExpenseAccountId, "debit");
  const payrollPayableGl = await glNet(reader, accounts.payrollPayableAccountId, "credit");
  const pph21Gl = await glNet(reader, accounts.pph21PayableAccountId, "credit");
  const bpjsGl = await glNet(reader, accounts.bpjsPayableAccountId, "credit");

  const lines: { label: string; subledger: string; gl: string; difference: string; matched: boolean }[] = [
    line("Beban gaji (Salary Expense)", sub.salaryExpense, salaryExpenseGl),
    line("Beban iuran BPJS (BPJS Expense)", sub.bpjsExpense, bpjsExpenseGl),
    line("Utang gaji net (Payroll Payable)", sub.payrollPayable, payrollPayableGl),
    line("Utang PPh 21", sub.pph21Payable, pph21Gl),
    line("Utang iuran BPJS (pekerja + pemberi)", sub.bpjsPayable, bpjsGl),
  ];
  if (otherAccountId) {
    const otherGl = await glNet(reader, otherAccountId, "credit");
    lines.push(line("Utang potongan lain", sub.otherDeductionPayable, otherGl));
  }

  return {
    accounts: { ...accounts, otherDeductionPayableAccountId: otherAccountId },
    inputs: {
      postedGross: toDb(sub.salaryExpense, DP),
      postedNet: toDb(sub.payrollPayable, DP),
      tax: toDb(tax, DP),
      bpjsEmployee: toDb(bpjsEmployee, DP),
      bpjsEmployer: toDb(bpjsEmployer, DP),
      otherDeduction: toDb(otherDeduction, DP),
    },
    lines,
    balanced: lines.every((l) => l.matched),
  };
}

/* ----------------------------- Helper GL ---------------------------- */

/** Saldo normal akun: aset/beban = debit; liabilitas/modal/pendapatan = kredit. */
async function glNet(reader: Reader, accountId: string, normal: "debit" | "credit"): Promise<Money> {
  const [row] = await reader
    .select({
      debit: sql<string>`coalesce(sum(${journalEntryLines.debit}), 0)::numeric(18,2)`,
      credit: sql<string>`coalesce(sum(${journalEntryLines.credit}), 0)::numeric(18,2)`,
    })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.entryId))
    .where(
      and(
        inArray(journalEntries.status, [...LEDGER_STATUSES]),
        eq(journalEntryLines.accountId, accountId),
      ),
    );
  const debit = dec(row?.debit ?? "0");
  const credit = dec(row?.credit ?? "0");
  return normal === "debit" ? debit.minus(credit) : credit.minus(debit);
}

function line(label: string, subledger: Money, gl: Money) {
  const difference = subledger.minus(gl);
  return {
    label,
    subledger: toDb(subledger, DP),
    gl: toDb(gl, DP),
    difference: toDb(difference, DP),
    matched: cmp(difference, "0") === 0,
  };
}
