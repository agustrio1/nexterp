/**
 * Helper bersama halaman Kas & Bank / Treasury (U7). Seluruh angka dari API;
 * nominal selalu string desimal. Envelope list tidak seragam:
 *  - bank-accounts/chart-accounts/cost-centers -> { data: [...] }
 *  - cash-transactions                          -> { data: [...], meta: { nextCursor } }
 *  - bank-statement-lines / reconciliations     -> { data: { items, nextCursor } }
 */
import { formatMoney } from "@/lib/money";

/* ------------------------------ Format ------------------------------ */

export function rp(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return formatMoney(value);
}

export function boolBadge(value: boolean): string {
  return value ? "Ya" : "Tidak";
}

/* ------------------------------- Regex ------------------------------ */

export const CODE_RE = /^[A-Z0-9][A-Z0-9.-]{1,29}$/; // bank code (dikapitalisasi)
export const AMOUNT_RE = /^\d{1,16}(\.\d{1,2})?$/; // nominal > 0
export const SIGNED_AMOUNT_RE = /^-?\d{1,16}(\.\d{1,2})?$/; // saldo statement (boleh negatif)
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const INT_0_30_RE = /^([0-9]|[12][0-9]|30)$/;

/* ---------------------------- Label & style ------------------------- */

export const KIND_LABEL: Record<string, string> = { cash: "Kas", bank: "Bank" };

export const TXN_TYPE_LABEL: Record<string, string> = {
  receipt: "Penerimaan",
  disbursement: "Pengeluaran",
  transfer: "Transfer",
};

export const TXN_STATUS_LABEL: Record<string, string> = {
  draft: "Draf",
  posted: "Terposting",
  reversed: "Direversal",
  cancelled: "Dibatalkan",
};

export const TXN_STATUS_STYLE: Record<string, string> = {
  draft: "rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  posted: "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300",
  reversed: "rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  cancelled: "rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300",
};

export const DIRECTION_LABEL: Record<string, string> = { in: "Masuk", out: "Keluar" };

export const RECON_STATUS_LABEL: Record<string, string> = { draft: "Draf", final: "Final" };
export const RECON_STATUS_STYLE: Record<string, string> = {
  draft: "rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  final: "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300",
};

/* ------------------------------- Tipe ------------------------------- */

export type BankAccount = {
  id: string; code: string; name: string; accountId: string; accountCode: string; accountName: string;
  kind: string; bankName: string | null; accountNumber: string | null; branchId: string | null;
  isActive: boolean; description: string | null;
};

export type ChartAccountRef = { id: string; code: string; name: string; type: string; isPostable: boolean; isActive: boolean };
export type CostCenterRef = { id: string; code: string; name: string };

export type CashTxn = {
  id: string; docNo: string | null; transactionDate: string; type: string; status: string;
  bankAccountId: string; bankAccountCode: string; bankAccountName: string;
  contraAccountId: string | null; contraAccountCode: string | null; contraAccountName: string | null;
  counterpartBankAccountId: string | null; counterpartCode: string | null; counterpartName: string | null;
  amount: string; branchId: string | null; costCenterId: string | null; journalEntryId: string | null;
  description: string; reference: string | null; reason: string | null;
};

export type StatementLine = {
  id: string; bankAccountId: string; bankAccountCode: string; statementDate: string; description: string;
  reference: string | null; direction: string; amount: string; bookBalanceAfter: string | null;
  reconciliationId: string | null; reconciliationDocNo: string | null;
  matchedCashTransactionId: string | null; matchedCashTransactionDocNo: string | null;
};

export type Reconciliation = {
  id: string; docNo: string | null; bankAccountId: string; bankAccountCode: string; bankAccountName: string;
  startDate: string; endDate: string; statementOpeningBalance: string; statementClosingBalance: string;
  bookBalanceStart: string | null; bookBalanceEnd: string | null; status: string; notes: string | null;
};

export type ReconDetail = Reconciliation & {
  summary: { totalLines: number; matchedLines: number; unmatchedLines: number; netStatementMovement: string };
  lines: StatementLine[];
};

export type Page<T> = { items: T[]; nextCursor: string | null };

/* ------------------------------- Fetch ------------------------------ */

type Envelope = { data?: unknown; meta?: { nextCursor?: string | null } };

async function getJson(url: string): Promise<Envelope> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Envelope;
}

export async function fetchBankAccounts(activeOnly = false): Promise<BankAccount[]> {
  const qs = activeOnly ? "?isActive=true" : "";
  const j = await getJson(`/api/bank-accounts${qs}`);
  return (j.data ?? []) as BankAccount[];
}

/** Akun GL postable & aktif (untuk penampung rekening & akun lawan). */
export async function fetchPostableAccounts(): Promise<ChartAccountRef[]> {
  const j = await getJson("/api/chart-accounts?isActive=true&isPostable=true");
  return (j.data ?? []) as ChartAccountRef[];
}

export async function fetchCostCenters(): Promise<CostCenterRef[]> {
  const j = await getJson("/api/cost-centers?isActive=true");
  return (j.data ?? []) as CostCenterRef[];
}

/** Transaksi kas: { data:[...], meta:{nextCursor} } */
export async function fetchCashPage(params: URLSearchParams): Promise<Page<CashTxn>> {
  const qs = params.toString();
  const j = await getJson(`/api/cash-transactions${qs ? `?${qs}` : ""}`);
  return { items: (j.data ?? []) as CashTxn[], nextCursor: j.meta?.nextCursor ?? null };
}

/** Baris statement: { data:{items,nextCursor} } */
export async function fetchStatementPage(params: URLSearchParams): Promise<Page<StatementLine>> {
  const qs = params.toString();
  const j = (await getJson(`/api/bank-statement-lines${qs ? `?${qs}` : ""}`)).data as { items?: StatementLine[]; nextCursor?: string | null } | undefined;
  return { items: j?.items ?? [], nextCursor: j?.nextCursor ?? null };
}

/** Daftar rekonsiliasi: { data:{items,nextCursor} } */
export async function fetchReconPage(params: URLSearchParams): Promise<Page<Reconciliation>> {
  const qs = params.toString();
  const j = (await getJson(`/api/reconciliations${qs ? `?${qs}` : ""}`)).data as { items?: Reconciliation[]; nextCursor?: string | null } | undefined;
  return { items: j?.items ?? [], nextCursor: j?.nextCursor ?? null };
}

export async function fetchReconDetail(id: string): Promise<ReconDetail> {
  const j = await getJson(`/api/reconciliations/${id}`);
  return j.data as ReconDetail;
}

export async function readError(res: Response): Promise<string> {
  const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return j?.error?.message ?? `Gagal (${res.status}).`;
}
