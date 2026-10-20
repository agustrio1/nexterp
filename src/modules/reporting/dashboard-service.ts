import { eq } from "drizzle-orm";

import { accountingPeriods } from "@/db/schema";
import {
  balanceSheet,
  cashFlowStatement,
  incomeStatement,
  trialBalance,
} from "@/modules/accounting/report-service";
import { apAging, purchaseReport } from "@/modules/purchasing/report-service";
import { arAging, salesReport } from "@/modules/sales/report-service";
import { inventoryValuation, expirySchedule, reorderReport } from "@/modules/inventory/report-service";
import {
  attendanceSummary,
  headcountByDepartment,
  leaveBalancesReport,
} from "@/modules/hr/report-service";
import { payrollCostByDepartment } from "@/modules/payroll/report-service";
import { assertCan, inTx, type Reader, type Tx } from "@/modules/jobs/_refs";
import { cmp } from "@/lib/money";
import { notFound } from "@/server/errors";
import type { AuthContext } from "@/server/authz";

import type { DashboardQuery } from "./dashboard-schemas";

/* ------------------------------------------------------------------ */
/* Dashboard (Tahap 8D). Semua angka DITURUNKAN dari service laporan    */
/* yang sudah ada — tidak ada query ledger baru di sini. Setiap         */
/* dashboard berjalan dalam satu transaksi agar seluruh kartu angka     */
/* berasal dari snapshot yang sama, dan tetap memeriksa izin laporan    */
/* sumbernya masing-masing (fail-closed).                                */
/* ------------------------------------------------------------------ */

/** Jumlah baris "teratas" yang ikut dikirim ke dashboard. */
const TOP_N = 5;

type Range = { from: string; to: string; source: "period" | "range" | "current-month" };

/** periodId -> tanggal periode; from/to -> dipakai; kosong -> bulan berjalan UTC. */
async function resolveRange(reader: Reader, query: DashboardQuery): Promise<Range> {
  if (query.periodId) {
    const [period] = await reader
      .select({ startDate: accountingPeriods.startDate, endDate: accountingPeriods.endDate })
      .from(accountingPeriods)
      .where(eq(accountingPeriods.id, query.periodId))
      .limit(1);
    if (!period) throw notFound("Periode akuntansi tidak ditemukan.");
    return { from: period.startDate, to: period.endDate, source: "period" };
  }
  if (query.from && query.to) {
    return { from: query.from, to: query.to, source: "range" };
  }
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return {
    from: first.toISOString().slice(0, 10),
    to: last.toISOString().slice(0, 10),
    source: "current-month",
  };
}

/** Urutkan baris berdasarkan kolom nominal string (desimal) secara menurun. */
function topBy<T>(rows: readonly T[], amount: (row: T) => string, limit = TOP_N): T[] {
  return [...rows].sort((a, b) => cmp(amount(b), amount(a))).slice(0, limit);
}

/* ------------------------------ Keuangan ----------------------------- */

/** Laba rugi + posisi neraca — dipakai ulang oleh dashboard eksekutif & keuangan. */
async function profitAndPosition(
  actor: AuthContext,
  range: Range,
  branchId: string | undefined,
  tx: Tx,
) {
  const pl = await incomeStatement(actor, { from: range.from, to: range.to, branchId }, tx);
  const bs = await balanceSheet(actor, { asOf: range.to, branchId }, tx);
  return {
    profit: {
      revenue: pl.totalRevenue,
      expense: pl.totalExpense,
      netIncome: pl.netIncome,
    },
    position: {
      assets: bs.totals.assets,
      liabilities: bs.totals.liabilities,
      equity: bs.totals.equity,
      retainedEarnings: bs.retainedEarnings,
      balanced: bs.totals.balanced,
    },
  };
}

/** Ringkasan eksekutif: laba, neraca, piutang, utang, nilai persediaan, headcount. */
export async function executiveDashboard(
  actor: AuthContext,
  query: DashboardQuery,
  externalTx?: Tx,
) {
  assertCan(actor, "reporting.dashboards.read");

  return inTx(externalTx, async (tx) => {
    const range = await resolveRange(tx, query);
    const { profit, position } = await profitAndPosition(actor, range, query.branchId, tx);
    const ar = await arAging(actor, { asOf: range.to, branchId: query.branchId }, tx);
    const ap = await apAging(actor, { asOf: range.to, branchId: query.branchId }, tx);
    const inv = await inventoryValuation(actor, { branchId: query.branchId }, tx);
    const hc = await headcountByDepartment(actor, { branchId: query.branchId }, tx);

    return {
      range,
      branchId: query.branchId ?? null,
      profit,
      position,
      receivables: { outstanding: ar.totalOutstandingBase, openInvoices: ar.rows.length },
      payables: { outstanding: ap.totalOutstandingBase, openInvoices: ap.rows.length },
      inventory: { value: inv.totalValue, quantity: inv.totalRemainingQuantity },
      headcount: hc.totalHeadcount,
    };
  });
}

/** Keuangan: laba rugi, neraca, keseimbangan neraca saldo, arus kas. */
export async function financeDashboard(
  actor: AuthContext,
  query: DashboardQuery,
  externalTx?: Tx,
) {
  assertCan(actor, "reporting.dashboards.read");

  return inTx(externalTx, async (tx) => {
    const range = await resolveRange(tx, query);
    const { profit, position } = await profitAndPosition(actor, range, query.branchId, tx);
    const tb = await trialBalance(actor, { from: range.from, to: range.to, branchId: query.branchId }, tx);
    const cf = await cashFlowStatement(actor, { from: range.from, to: range.to, branchId: query.branchId }, tx);

    return {
      range,
      branchId: query.branchId ?? null,
      profit,
      position,
      trialBalance: { accounts: tb.rows.length, debit: tb.totals.debit, credit: tb.totals.credit, balanced: tb.totals.balanced },
      cashFlow: {
        operating: cf.operating.net,
        investing: cf.investing.net,
        financing: cf.financing.net,
        netChange: cf.netChangeFromTransactions,
        reconciles: cf.reconciliation.reconciles,
      },
    };
  });
}

/** Arus kas penuh: per seksi + rekonsiliasi ke saldo GL kas/bank. */
export async function cashFlowDashboard(
  actor: AuthContext,
  query: DashboardQuery,
  externalTx?: Tx,
) {
  assertCan(actor, "reporting.dashboards.read");

  return inTx(externalTx, async (tx) => {
    const range = await resolveRange(tx, query);
    const cf = await cashFlowStatement(actor, { from: range.from, to: range.to, branchId: query.branchId }, tx);

    return {
      range,
      branchId: query.branchId ?? null,
      method: cf.method,
      sections: {
        operating: { inflow: cf.operating.inflow, outflow: cf.operating.outflow, net: cf.operating.net },
        investing: { inflow: cf.investing.inflow, outflow: cf.investing.outflow, net: cf.investing.net },
        financing: { inflow: cf.financing.inflow, outflow: cf.financing.outflow, net: cf.financing.net },
      },
      internalTransfers: cf.internalTransfers,
      reconciliation: cf.reconciliation,
      cashByAccount: cf.cashByAccount,
    };
  });
}

/* ------------------------------ Penjualan ---------------------------- */

export async function salesDashboard(
  actor: AuthContext,
  query: DashboardQuery,
  externalTx?: Tx,
) {
  assertCan(actor, "reporting.dashboards.read");

  return inTx(externalTx, async (tx) => {
    const range = await resolveRange(tx, query);
    const sr = await salesReport(actor, { from: range.from, to: range.to, branchId: query.branchId }, tx);
    const ar = await arAging(actor, { asOf: range.to, branchId: query.branchId }, tx);

    return {
      range,
      branchId: query.branchId ?? null,
      totals: sr.totals,
      customers: sr.rows.length,
      topCustomersByOutstanding: topBy(sr.rows, (r) => r.outstanding).map((r) => ({
        customerCode: r.customerCode,
        customerName: r.customerName,
        outstanding: r.outstanding,
      })),
      aging: { outstanding: ar.totalOutstandingBase, buckets: ar.buckets },
    };
  });
}

/* ----------------------------- Pembelian ----------------------------- */

export async function purchasingDashboard(
  actor: AuthContext,
  query: DashboardQuery,
  externalTx?: Tx,
) {
  assertCan(actor, "reporting.dashboards.read");

  return inTx(externalTx, async (tx) => {
    const range = await resolveRange(tx, query);
    const pr = await purchaseReport(actor, { from: range.from, to: range.to, branchId: query.branchId }, tx);
    const ap = await apAging(actor, { asOf: range.to, branchId: query.branchId }, tx);

    return {
      range,
      branchId: query.branchId ?? null,
      totals: pr.totals,
      suppliers: pr.rows.length,
      topSuppliersByOutstanding: topBy(pr.rows, (r) => r.outstanding).map((r) => ({
        supplierCode: r.supplierCode,
        supplierName: r.supplierName,
        outstanding: r.outstanding,
      })),
      aging: { outstanding: ap.totalOutstandingBase, buckets: ap.buckets },
    };
  });
}

/* ---------------------------- Persediaan ----------------------------- */

export async function inventoryDashboard(
  actor: AuthContext,
  query: DashboardQuery,
  externalTx?: Tx,
) {
  assertCan(actor, "reporting.dashboards.read");

  return inTx(externalTx, async (tx) => {
    const inv = await inventoryValuation(actor, { branchId: query.branchId }, tx);
    const reorder = await reorderReport(actor, { branchId: query.branchId }, tx);
    const expiry = await expirySchedule(actor, { branchId: query.branchId }, tx);

    return {
      valuation: {
        value: inv.totalValue,
        quantity: inv.totalRemainingQuantity,
        lines: inv.rows.length,
        topByValue: topBy(inv.rows, (r) => r.value).map((r) => ({
          productSku: r.productSku,
          productName: r.productName,
          warehouseCode: r.warehouseCode,
          value: r.value,
        })),
      },
      lowStock: {
        count: reorder.count,
        items: reorder.rows.map((r) => ({
          productSku: r.productSku,
          productName: r.productName,
          onHand: r.onHand,
          reorderPoint: r.reorderPoint,
          suggestedQuantity: r.suggestedQuantity,
        })),
      },
      nearExpiry: {
        count: expiry.rows.length,
        horizon: expiry.horizon,
        items: expiry.rows.slice(0, TOP_N).map((r) => ({
          productSku: r.productSku,
          productName: r.productName,
          warehouseCode: r.warehouseCode,
          expiryDate: r.expiryDate,
          remaining: r.remaining,
        })),
      },
    };
  });
}

/* -------------------------------- HR --------------------------------- */

export async function hrDashboard(actor: AuthContext, query: DashboardQuery, externalTx?: Tx) {
  assertCan(actor, "reporting.dashboards.read");

  return inTx(externalTx, async (tx) => {
    const range = await resolveRange(tx, query);
    const hc = await headcountByDepartment(actor, { branchId: query.branchId }, tx);
    const att = await attendanceSummary(
      actor,
      { from: range.from, to: range.to, branchId: query.branchId },
      tx,
    );
    const leave = await leaveBalancesReport(actor, {}, tx);

    return {
      range,
      branchId: query.branchId ?? null,
      headcount: { total: hc.totalHeadcount, departments: hc.rows.length },
      attendance: { ...att.totals, employees: att.rows.length },
      leaveBalances: { year: leave.year, totalRemaining: leave.totalRemaining, employees: leave.rows.length },
    };
  });
}

/* ------------------------------ Payroll ------------------------------ */

export async function payrollDashboard(
  actor: AuthContext,
  query: DashboardQuery,
  externalTx?: Tx,
) {
  assertCan(actor, "reporting.dashboards.read");

  return inTx(externalTx, async (tx) => {
    const cost = await payrollCostByDepartment(
      actor,
      { periodId: query.periodId, branchId: query.branchId },
      tx,
    );

    return {
      periodId: query.periodId ?? null,
      branchId: query.branchId ?? null,
      totals: cost.totals,
      departments: cost.rows.length,
      topByTotalCost: topBy(cost.rows, (r) => r.totalCost).map((r) => ({
        departmentCode: r.departmentCode,
        departmentName: r.departmentName,
        employeeCount: r.employeeCount,
        totalCost: r.totalCost,
      })),
    };
  });
}
