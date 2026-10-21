/**
 * Helper bersama halaman Dashboard (U6D). Semua angka DITURUNKAN dari
 * /api/dashboard/* (service laporan sumber) — tidak ada kalkulasi di sisi klien.
 * Nominal selalu string desimal dari API; format memakai formatMoney.
 */
import { formatMoney } from "@/lib/money";

/* ------------------------------ Format ------------------------------ */

export function rp(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return formatMoney(value);
}

/** Kuantitas/ukuran: terima number ATAU string desimal, tampil rapi. */
export function qty(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return value.toLocaleString("id-ID");
  return formatMoney(value);
}

/** Bilangan bulat (count). */
export function num(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("id-ID");
}

export function boolBadge(value: boolean): string {
  return value ? "Ya" : "Tidak";
}

/* ------------------------------- Tipe ------------------------------- */

export type Range = { from: string; to: string; source: "period" | "range" | "current-month" };
type Profit = { revenue: string; expense: string; netIncome: string };
type Position = { assets: string; liabilities: string; equity: string; retainedEarnings: string; balanced: boolean };
export type Bucket = { key: string; label: string; count: number; amount: string };

export type ExecutiveData = {
  range: Range;
  profit: Profit;
  position: Position;
  receivables: { outstanding: string; openInvoices: number };
  payables: { outstanding: string; openInvoices: number };
  inventory: { value: string; quantity: number };
  headcount: number;
};

export type FinanceData = {
  range: Range;
  profit: Profit;
  position: Position;
  trialBalance: { accounts: number; debit: string; credit: string; balanced: boolean };
  cashFlow: { operating: string; investing: string; financing: string; netChange: string; reconciles: boolean };
};

export type CashFlowData = {
  range: Range;
  method: string;
  sections: {
    operating: { inflow: string; outflow: string; net: string };
    investing: { inflow: string; outflow: string; net: string };
    financing: { inflow: string; outflow: string; net: string };
  };
  reconciliation: { reconciles: boolean };
};

export type SalesData = {
  range: Range;
  totals: { soCount: number; soValue: string; invoiceValue: string; creditValue: string; paymentValue: string; outstanding: string };
  customers: number;
  topCustomersByOutstanding: Array<{ customerCode: string; customerName: string; outstanding: string }>;
  aging: { outstanding: string; buckets: Bucket[] };
};

export type PurchasingData = {
  range: Range;
  totals: { poCount: number; poValue: string; invoiceValue: string; paymentValue: string; outstanding: string };
  suppliers: number;
  topSuppliersByOutstanding: Array<{ supplierCode: string; supplierName: string; outstanding: string }>;
  aging: { outstanding: string; buckets: Bucket[] };
};

export type InventoryData = {
  valuation: { value: string; quantity: number; lines: number; topByValue: Array<{ productSku: string; productName: string; warehouseCode: string; value: string }> };
  lowStock: { count: number; items: Array<{ productSku: string; productName: string; onHand: string | number; reorderPoint: string | number; suggestedQuantity: string | number }> };
  nearExpiry: { count: number; horizon: number; items: Array<{ productSku: string; productName: string; warehouseCode: string; expiryDate: string; remaining: string | number }> };
};

export type HrData = {
  range: Range;
  headcount: { total: number; departments: number };
  attendance: { records: number; overtimeMinutes: number; employees: number };
  leaveBalances: { year: number; totalRemaining: number; employees: number };
};

export type PayrollData = {
  periodId: string | null;
  totals: { employeeCount: number; grossEarnings: string; netPay: string; tax: string; totalCost: string };
  departments: number;
  topByTotalCost: Array<{ departmentCode: string; departmentName: string; employeeCount: number; totalCost: string }>;
};

/* ------------------------------- Fetch ------------------------------ */

export type DashKey = "executive" | "finance" | "cashflow" | "sales" | "purchasing" | "inventory" | "hr" | "payroll";

const PATHS: Record<DashKey, string> = {
  executive: "executive",
  finance: "finance",
  cashflow: "cash-flow",
  sales: "sales",
  purchasing: "purchasing",
  inventory: "inventory",
  hr: "hr",
  payroll: "payroll",
};

export const DASH_TABS: Array<{ key: DashKey; label: string }> = [
  { key: "executive", label: "Eksekutif" },
  { key: "finance", label: "Keuangan" },
  { key: "cashflow", label: "Arus Kas" },
  { key: "sales", label: "Penjualan" },
  { key: "purchasing", label: "Pembelian" },
  { key: "inventory", label: "Persediaan" },
  { key: "hr", label: "SDM" },
  { key: "payroll", label: "Payroll" },
];

export class DashboardAccessError extends Error {
  constructor(public readonly status: number) {
    super(status === 403 ? "no_access" : "error");
  }
}

/** GET /api/dashboard/{path} dengan filter; melempar DashboardAccessError untuk 403. */
export async function fetchDashboard<T>(key: DashKey, params: URLSearchParams): Promise<T> {
  const qs = params.toString();
  const url = `/api/dashboard/${PATHS[key]}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new DashboardAccessError(res.status);
  const json = (await res.json()) as { data: T };
  return json.data;
}
