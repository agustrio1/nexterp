import type { z } from "zod";

import {
  balanceSheet,
  budgetRealization,
  cashBook,
  cashFlowStatement,
  costCenterReport,
  generalLedger,
  incomeStatement,
  trialBalance,
} from "@/modules/accounting/report-service";
import {
  balanceSheetQuerySchema,
  budgetRealizationQuerySchema,
  cashBookQuerySchema,
  cashFlowQuerySchema,
  costCenterReportQuerySchema,
  generalLedgerQuerySchema,
  incomeStatementQuerySchema,
  trialBalanceQuerySchema,
} from "@/modules/accounting/report-schemas";
import { assetGlReconciliation, assetRegister } from "@/modules/assets/report-service";
import { assetReconciliationQuerySchema, assetRegisterQuerySchema } from "@/modules/assets/report-schemas";
import { headcountByDepartment, attendanceSummary, leaveBalancesReport } from "@/modules/hr/report-service";
import {
  attendanceSummaryQuerySchema,
  headcountQuerySchema,
  leaveBalancesQuerySchema,
} from "@/modules/hr/report-schemas";
import {
  expirySchedule,
  inventoryValuation,
  reorderReport,
  stockCard,
} from "@/modules/inventory/report-service";
import {
  expiryScheduleQuerySchema,
  inventoryValuationQuerySchema,
  reorderQuerySchema,
  stockCardQuerySchema,
} from "@/modules/inventory/report-schemas";
import { apAging, apGlReconciliation, purchaseReport } from "@/modules/purchasing/report-service";
import {
  apAgingQuerySchema,
  apReconciliationQuerySchema,
  purchaseReportQuerySchema,
} from "@/modules/purchasing/report-schemas";
import {
  payrollCostByDepartment,
  payrollGlReconciliation,
  payslipRegister,
} from "@/modules/payroll/report-service";
import {
  payrollCostByDepartmentQuerySchema,
  payrollReconciliationQuerySchema,
  payslipRegisterQuerySchema,
} from "@/modules/payroll/report-schemas";
import { projectProfitability } from "@/modules/projects/report-service";
import { profitabilityQuerySchema } from "@/modules/projects/report-schemas";
import { arAging, arGlReconciliation, salesReport } from "@/modules/sales/report-service";
import {
  arAgingQuerySchema,
  arReconciliationQuerySchema,
  salesReportQuerySchema,
} from "@/modules/sales/report-schemas";
import { assertCan, type Tx } from "@/modules/jobs/_refs";
import type { AuthContext, PermissionCode } from "@/server/authz";

import type { CsvRow } from "./csv";

/* ------------------------------------------------------------------ */
/* Katalog laporan yang bisa diekspor CSV (Tahap 8D).                  */
/* Tidak ada query baru di sini: satu entri = satu laporan yang sudah  */
/* ada, plus pemetaan hasil -> baris CSV. Izin sumber ditegakkan dua    */
/* kali: saat enqueue (entri.permission) dan saat loader laporan jalan.  */
/* ------------------------------------------------------------------ */

export type ExportOutcome = { rows: CsvRow[] };

/** Versi type-erased yang dipakai service job & handler. */
export type ExportEntry = {
  key: string;
  label: string;
  permission: PermissionCode;
  /** Validasi query mentah dari body API (fail-fast saat enqueue). */
  parseQuery: (raw: unknown) => unknown;
  /** Jalankan laporan sumber, petakan hasilnya ke baris CSV. */
  build: (actor: AuthContext, query: unknown, tx?: Tx) => Promise<ExportOutcome>;
};

function defineEntry<Q, R>(spec: {
  key: string;
  label: string;
  permission: PermissionCode;
  schema: z.ZodType<Q>;
  load: (actor: AuthContext, query: Q, tx?: Tx) => Promise<R>;
  rowsOf: (result: R) => CsvRow[];
}): ExportEntry {
  return {
    key: spec.key,
    label: spec.label,
    permission: spec.permission,
    parseQuery: (raw) => spec.schema.parse(raw),
    // `query` adalah hasil parseQuery saat enqueue (payload jsonb server-generated),
    // sehingga type-erase terjadi di satu titik terkendali, bukan di pemanggilan liar.
    build: async (actor, query, tx) => ({
      rows: spec.rowsOf(await spec.load(actor, query as Q, tx)),
    }),
  };
}

/* ------------------------------ Akses umum ------------------------------ */

const fromRows = <R extends { rows: CsvRow[] }>(result: R) => result.rows;
const fromLines = <R extends { lines: CsvRow[] }>(result: R) => result.lines;

/** Tandai bagian laporan bersection (label CSV pada kolom `section`). */
const section = (name: string, rows: readonly CsvRow[]): CsvRow[] =>
  rows.map((row) => ({ section: name, ...row }));

/* ------------------------------- Entri --------------------------------- */

export const EXPORT_ENTRIES: readonly ExportEntry[] = [
  defineEntry({
    key: "trial-balance",
    label: "Neraca Saldo",
    permission: "accounting.reports.read",
    schema: trialBalanceQuerySchema,
    load: trialBalance,
    rowsOf: fromRows,
  }),
  defineEntry({
    key: "general-ledger",
    label: "Buku Besar",
    permission: "accounting.reports.read",
    schema: generalLedgerQuerySchema,
    load: generalLedger,
    rowsOf: fromRows,
  }),
  defineEntry({
    key: "income-statement",
    label: "Laba Rugi",
    permission: "accounting.reports.read",
    schema: incomeStatementQuerySchema,
    load: incomeStatement,
    rowsOf: (r) => [
      ...section("pendapatan", r.revenue),
      ...section("beban", r.expense),
      { section: "total", code: "", name: "Total pendapatan", amount: r.totalRevenue },
      { section: "total", code: "", name: "Total beban", amount: r.totalExpense },
      { section: "total", code: "", name: "Laba bersih", amount: r.netIncome },
    ],
  }),
  defineEntry({
    key: "balance-sheet",
    label: "Neraca",
    permission: "accounting.reports.read",
    schema: balanceSheetQuerySchema,
    load: balanceSheet,
    rowsOf: (r) => [
      ...section("aset", r.assets),
      ...section("liabilitas", r.liabilities),
      ...section("ekuitas", r.equity),
      {
        section: "total",
        code: "",
        name: "Laba ditahan sementara",
        amount: r.retainedEarnings,
      },
    ],
  }),
  defineEntry({
    key: "cost-center",
    label: "Laporan Pusat Biaya",
    permission: "accounting.reports.read",
    schema: costCenterReportQuerySchema,
    load: costCenterReport,
    rowsOf: fromRows,
  }),
  defineEntry({
    key: "cash-book",
    label: "Buku Kas / Bank",
    permission: "accounting.reports.read",
    schema: cashBookQuerySchema,
    load: cashBook,
    rowsOf: fromRows,
  }),
  defineEntry({
    key: "budget-realization",
    label: "Realisasi Anggaran",
    permission: "accounting.reports.read",
    schema: budgetRealizationQuerySchema,
    load: budgetRealization,
    rowsOf: fromLines,
  }),
  defineEntry({
    key: "cash-flow",
    label: "Arus Kas (Metode Langsung)",
    permission: "accounting.reports.read",
    schema: cashFlowQuerySchema,
    load: cashFlowStatement,
    rowsOf: (r) => [
      ...section("operasi", r.operating.lines),
      ...section("investasi", r.investing.lines),
      ...section("pendanaan", r.financing.lines),
      ...r.cashByAccount.map((a) => ({
        section: "saldo kas",
        code: a.code,
        name: a.name,
        inflow: a.opening,
        outflow: a.closing,
        net: "",
      })),
    ],
  }),
  defineEntry({
    key: "ar-aging",
    label: "Umur Piutang",
    permission: "sales.ar.read",
    schema: arAgingQuerySchema,
    load: arAging,
    rowsOf: fromRows,
  }),
  defineEntry({
    key: "sales",
    label: "Laporan Penjualan",
    permission: "sales.reports.read",
    schema: salesReportQuerySchema,
    load: salesReport,
    rowsOf: fromRows,
  }),
  defineEntry({
    key: "ar-reconciliation",
    label: "Rekonsiliasi AR ke GL",
    permission: "sales.reports.read",
    schema: arReconciliationQuerySchema,
    load: arGlReconciliation,
    rowsOf: fromLines,
  }),
  defineEntry({
    key: "ap-aging",
    label: "Umur Utang",
    permission: "purchasing.ap.read",
    schema: apAgingQuerySchema,
    load: apAging,
    rowsOf: fromRows,
  }),
  defineEntry({
    key: "purchase",
    label: "Laporan Pembelian",
    permission: "purchasing.reports.read",
    schema: purchaseReportQuerySchema,
    load: purchaseReport,
    rowsOf: fromRows,
  }),
  defineEntry({
    key: "ap-reconciliation",
    label: "Rekonsiliasi AP ke GL",
    permission: "purchasing.reports.read",
    schema: apReconciliationQuerySchema,
    load: apGlReconciliation,
    rowsOf: fromLines,
  }),
  defineEntry({
    key: "stock-card",
    label: "Kartu Stok",
    permission: "inventory.stock.read",
    schema: stockCardQuerySchema,
    load: stockCard,
    rowsOf: fromRows,
  }),
  defineEntry({
    key: "inventory-valuation",
    label: "Valuasi Persediaan",
    permission: "inventory.stock.read",
    schema: inventoryValuationQuerySchema,
    load: inventoryValuation,
    rowsOf: fromRows,
  }),
  defineEntry({
    key: "reorder",
    label: "Perintah Pemesanan Kembali",
    permission: "inventory.stock.read",
    schema: reorderQuerySchema,
    load: reorderReport,
    rowsOf: fromRows,
  }),
  defineEntry({
    key: "expiry-schedule",
    label: "Jadwal Kedaluwarsa",
    permission: "inventory.stock.read",
    schema: expiryScheduleQuerySchema,
    load: expirySchedule,
    rowsOf: fromRows,
  }),
  defineEntry({
    key: "hr-headcount",
    label: "Jumlah Karyawan per Departemen",
    permission: "hr.reports.read",
    schema: headcountQuerySchema,
    load: headcountByDepartment,
    rowsOf: fromRows,
  }),
  defineEntry({
    key: "hr-attendance",
    label: "Rekap Absensi",
    permission: "hr.reports.read",
    schema: attendanceSummaryQuerySchema,
    load: attendanceSummary,
    rowsOf: fromRows,
  }),
  defineEntry({
    key: "hr-leave-balances",
    label: "Saldo Cuti",
    permission: "hr.reports.read",
    schema: leaveBalancesQuerySchema,
    load: leaveBalancesReport,
    rowsOf: fromRows,
  }),
  defineEntry({
    key: "payroll-by-department",
    label: "Beban Gaji per Departemen",
    permission: "payroll.reports.read",
    schema: payrollCostByDepartmentQuerySchema,
    load: payrollCostByDepartment,
    rowsOf: fromRows,
  }),
  defineEntry({
    key: "payslip-register",
    label: "Daftar Slip Gaji",
    permission: "payroll.reports.read",
    schema: payslipRegisterQuerySchema,
    load: payslipRegister,
    rowsOf: fromRows,
  }),
  defineEntry({
    key: "payroll-reconciliation",
    label: "Rekonsiliasi Payroll ke GL",
    permission: "payroll.reports.read",
    schema: payrollReconciliationQuerySchema,
    load: payrollGlReconciliation,
    rowsOf: fromLines,
  }),
  defineEntry({
    key: "asset-register",
    label: "Register Aset Tetap",
    permission: "assets.reports.read",
    schema: assetRegisterQuerySchema,
    load: assetRegister,
    rowsOf: fromRows,
  }),
  defineEntry({
    key: "asset-reconciliation",
    label: "Rekonsiliasi Aset ke GL",
    permission: "assets.reports.read",
    schema: assetReconciliationQuerySchema,
    load: assetGlReconciliation,
    rowsOf: fromLines,
  }),
  defineEntry({
    key: "project-profitability",
    label: "Profitabilitas Proyek",
    permission: "projects.reports.read",
    schema: profitabilityQuerySchema,
    load: projectProfitability,
    // Varian anggaran (array) ikut tersimpan sebagai JSON pada sel — csv.ts
    // memserialisasi objek/array, jadi ekspor tetap lossless.
    rowsOf: (r) => r.items,
  }),
];

const BY_KEY = new Map(EXPORT_ENTRIES.map((entry) => [entry.key, entry]));

export function findExportEntry(key: string): ExportEntry | undefined {
  return BY_KEY.get(key);
}

/** Daftar katalog untuk UI/API (tanpa detail teknis). */
export function listExportCatalog() {
  return EXPORT_ENTRIES.map((entry) => ({
    key: entry.key,
    label: entry.label,
    permission: entry.permission,
  }));
}

/** Katalog yang dilihat calon pengunduh/penjalankan ekspor. */
export function describeExportCatalog(actor: AuthContext) {
  assertCan(actor, "reporting.exports.read");
  return listExportCatalog();
}
