/**
 * Helper bersama halaman Anggaran, Pusat Biaya, & Pajak (U8). Seluruh angka dari
 * API; nominal & tarif selalu string desimal. Envelope list:
 *  - budget / cost-center / tax / fiscal-year / chart-account -> { data: [...] }
 *  - tax-transactions                                          -> { data: [...], meta: { nextCursor } }
 */
import { formatMoney } from "@/lib/money";

/* ------------------------------ Format ------------------------------ */

export function rp(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return formatMoney(value);
}

/* ------------------------------- Regex ------------------------------ */

export const CODE_RE = /^[A-Z0-9][A-Z0-9.-]{1,29}$/; // kode (dikapitalisasi)
export const AMOUNT_RE = /^\d{1,16}(\.\d{1,2})?$/; // nominal >= 0
export const POSITIVE_RE = /^(?!0+(?:\.0+)?$)\d{1,16}(\.\d{1,2})?$/; // nominal > 0
export const RATE_RE = /^\d{1,5}(\.\d{1,4})?$/; // tarif 0..100
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ---------------------------- Label & style ------------------------- */

export const COST_TYPE_LABEL: Record<string, string> = {
  asset: "Aset", liability: "Kewajiban", equity: "Ekuitas", revenue: "Pendapatan", expense: "Beban",
};

export const TAX_KIND_LABEL: Record<string, string> = {
  output: "Keluaran", input: "Masukan", withholding: "Potongan/Pungutan",
};

export const TAX_DIRECTION_LABEL: Record<string, string> = {
  collect: "Pungut (keluaran)", pay: "Bayar (masukan)",
};

export const BUDGET_STATUS_LABEL: Record<string, string> = { draft: "Draf", approved: "Disetujui" };
export const BUDGET_STATUS_STYLE: Record<string, string> = {
  draft: "rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  approved: "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300",
};

export const FY_STATUS_LABEL: Record<string, string> = { open: "Terbuka", closed: "Ditutup" };

/* ------------------------------- Tipe ------------------------------- */

export type FiscalYear = { id: string; code: string; startDate: string; endDate: string; status: string };
export type Period = { id: string; fiscalYearId: string; periodNo: number; startDate: string; endDate: string; status: string };
export type FiscalYearDetail = FiscalYear & { periods: Period[] };

export type ChartAccount = {
  id: string; code: string; name: string; type: string; parentId: string | null;
  isPostable: boolean; isActive: boolean; description: string | null;
};

export type CostCenter = {
  id: string; code: string; name: string; parentId: string | null; branchId: string | null;
  isActive: boolean; description: string | null;
};

export type Budget = {
  id: string; docNo: string | null; name: string; fiscalYearId: string; fiscalYearCode: string;
  branchId: string | null; branchName: string | null; status: string; notes: string | null;
  approvedAt: string | null;
};

export type BudgetLine = {
  id: string; budgetId: string; accountId: string; accountCode: string; accountName: string; accountType: string;
  periodId: string; periodNo: number; costCenterId: string | null; costCenterCode: string | null;
  amount: string; note: string | null;
};

export type BudgetDetail = Budget & { lines: BudgetLine[] };

export type RealizationLine = {
  accountCode: string; accountName: string; accountType: string; periodNo: number;
  costCenterCode: string | null; budget: string; actual: string; variance: string; realizationPct: string | null;
};
export type BudgetRealization = {
  budget: { id: string; name: string; docNo: string | null; status: string; fiscalYearCode: string; branchId: string | null };
  range: { from: string; to: string };
  periodFilter: string | null;
  lines: RealizationLine[];
  totals: { budget: string; actual: string; variance: string };
};

export type Tax = {
  id: string; code: string; name: string; kind: string; taxAccountId: string;
  accountCode: string; accountName: string; isActive: boolean; description: string | null;
};

export type TaxRate = {
  id: string; taxId: string; rate: string; effectiveFrom: string; source: string; note: string | null;
};

export type TaxTxn = {
  id: string; docNo: string | null; taxId: string; taxCode: string; taxName: string;
  transactionDate: string; periodId: string; direction: string; baseAmount: string; rate: string;
  taxAmount: string; branchId: string | null; costCenterId: string | null; journalEntryId: string | null;
  notes: string | null;
};

export type Page<T> = { items: T[]; nextCursor: string | null };

/* ------------------------------- Fetch ------------------------------ */

type Envelope = { data?: unknown; meta?: { nextCursor?: string | null } };

async function getJson(url: string): Promise<Envelope> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Envelope;
}

async function getList<T>(url: string): Promise<T[]> {
  return (await getJson(url)).data as T[] ?? [];
}

export function fetchFiscalYears(): Promise<FiscalYear[]> {
  return getList<FiscalYear>("/api/fiscal-years");
}

export async function fetchFiscalYearDetail(id: string): Promise<FiscalYearDetail> {
  return (await getJson(`/api/fiscal-years/${id}`)).data as FiscalYearDetail;
}

export function fetchChartAccounts(): Promise<ChartAccount[]> {
  return getList<ChartAccount>("/api/chart-accounts");
}

/** Akun daun postable & aktif (penampung baris anggaran). */
export async function fetchPostableAccounts(): Promise<ChartAccount[]> {
  const all = await fetchChartAccounts();
  return all.filter((a) => a.isActive && a.isPostable);
}

export function fetchCostCenters(activeOnly = false): Promise<CostCenter[]> {
  const qs = activeOnly ? "?isActive=true" : "";
  return getList<CostCenter>(`/api/cost-centers${qs}`);
}

export function fetchTaxes(activeOnly = false): Promise<Tax[]> {
  const qs = activeOnly ? "?isActive=true" : "";
  return getList<Tax>(`/api/taxes${qs}`);
}

export function fetchTaxRates(taxId: string): Promise<TaxRate[]> {
  return getList<TaxRate>(`/api/taxes/${taxId}/rates`);
}

export function fetchBudgets(params: URLSearchParams): Promise<Budget[]> {
  const qs = params.toString();
  return getList<Budget>(`/api/budgets${qs ? `?${qs}` : ""}`);
}

export async function fetchBudgetDetail(id: string): Promise<BudgetDetail> {
  return (await getJson(`/api/budgets/${id}`)).data as BudgetDetail;
}

export async function fetchBudgetRealization(budgetId: string, periodId?: string): Promise<BudgetRealization> {
  const p = new URLSearchParams({ budgetId });
  if (periodId) p.set("periodId", periodId);
  return (await getJson(`/api/reports/budget-realization?${p}`)).data as BudgetRealization;
}

/** Transaksi pajak: { data:[...], meta:{nextCursor} } */
export async function fetchTaxTxnPage(params: URLSearchParams): Promise<Page<TaxTxn>> {
  const qs = params.toString();
  const j = await getJson(`/api/tax-transactions${qs ? `?${qs}` : ""}`);
  return { items: (j.data ?? []) as TaxTxn[], nextCursor: j.meta?.nextCursor ?? null };
}

export async function readError(res: Response): Promise<string> {
  const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return j?.error?.message ?? `Gagal (${res.status}).`;
}

/** Nominal > 0 untuk input pengguna. */
export const isPositive = (v: string): boolean => AMOUNT_RE.test(v) && /[1-9]/.test(v.replace(".", ""));
