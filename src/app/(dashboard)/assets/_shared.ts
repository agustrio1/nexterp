/**
 * Helper bersama halaman Aset Tetap: memuat daftar referensi (kategori, aset,
 * periode akuntansi) untuk mapping nama di tabel & opsi select, serta label
 * status/metode seragam. Setiap fetch gagal (mis. izin tidak ada) jatuh ke
 * array kosong — halaman tetap tampil dengan "—" pada kolom terkait.
 */
import { formatMoney } from "@/lib/money";

export type CategoryRef = {
  id: string; code: string; name: string;
  depreciationMethod: string; usefulLifeMonths: number; isActive: boolean;
};
export type AssetRef = { id: string; code: string; name: string; status: string; isActive: boolean };
export type BankRef = { id: string; name: string; kind: string; isActive: boolean };
export type FiscalYearRef = { id: string; code: string; startDate: string; endDate: string; status: string };
export type PeriodRef = {
  id: string; fiscalYearId: string; periodNo: number;
  startDate: string; endDate: string; status: string; fiscalYearCode?: string;
};

async function getJson<T>(url: string): Promise<T[]> {
  try {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) return [];
    const j = (await res.json()) as { data?: T[] };
    return Array.isArray(j.data) ? j.data : [];
  } catch {
    return [];
  }
}

export async function fetchCategories(): Promise<CategoryRef[]> {
  return getJson<CategoryRef>("/api/assets/categories");
}

export async function fetchAssets(): Promise<AssetRef[]> {
  return getJson<AssetRef>("/api/assets/register");
}

export async function fetchBankAccounts(): Promise<BankRef[]> {
  return getJson<BankRef>("/api/bank-accounts?isActive=true");
}

export async function fetchFiscalYears(): Promise<FiscalYearRef[]> {
  return getJson<FiscalYearRef>("/api/fiscal-years");
}

/**
 * Periode akuntansi (untuk selector run penyusutan). Muat daftar tahun fiskal,
 * lalu periode tiap tahun (paralel) dan diratakan. Gagal → array kosong.
 */
export async function fetchAccountingPeriods(): Promise<PeriodRef[]> {
  const years = await fetchFiscalYears();
  if (years.length === 0) return [];
  const details = await Promise.all(
    years.map(async (y) => {
      try {
        const res = await fetch(`/api/fiscal-years/${y.id}`, { credentials: "same-origin" });
        if (!res.ok) return [] as PeriodRef[];
        const j = (await res.json()) as { data?: { periods?: PeriodRef[] } };
        return (j.data?.periods ?? []).map((p) => ({ ...p, fiscalYearCode: y.code }));
      } catch {
        return [] as PeriodRef[];
      }
    }),
  );
  return details.flat();
}

export function toMap<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((i) => [i.id, i]));
}

/** Format nominal uang gaya Indonesia; pakai string desimal dari API apa adanya. */
export function rp(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return formatMoney(value);
}

export function periodLabel(p: PeriodRef | undefined): string {
  if (!p) return "—";
  return `${p.fiscalYearCode ?? ""} · P${String(p.periodNo).padStart(2, "0")}`.trim();
}

export const CATEGORY_METHOD_LABEL: Record<string, string> = {
  straight_line: "Garis Lurus",
  declining_balance: "Saldo Menurun",
  units_of_production: "Unit Produksi",
};

export const ASSET_STATUS_LABEL: Record<string, string> = {
  draft: "Draf",
  active: "Aktif",
  idle: "Terlantar",
  in_service: "Operasional",
  disposed: "Dilepas",
};

export const ASSET_STATUS_STYLE: Record<string, string> = {
  draft: "rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  active: "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300",
  idle: "rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  in_service: "rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  disposed: "rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300",
};

/** Status dokumen (akuisisi/pelepasan). */
export const DOC_STATUS_LABEL: Record<string, string> = {
  draft: "Draf",
  posted: "Diposting",
  reversed: "Direversal",
  cancelled: "Dibatalkan",
};

export const DOC_STATUS_STYLE: Record<string, string> = {
  draft: "rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  posted: "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300",
  reversed: "rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  cancelled: "rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300",
};

export const RUN_STATUS_LABEL: Record<string, string> = {
  draft: "Draf",
  calculated: "Terhitung",
  approved: "Disetujui",
  posted: "Diposting",
  cancelled: "Dibatalkan",
  reversed: "Direversal",
};

export const RUN_STATUS_STYLE: Record<string, string> = {
  draft: "rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  calculated: "rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  approved: "rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300",
  posted: "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300",
  cancelled: "rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300",
  reversed: "rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900 dark:text-amber-300",
};

export const FUNDING_LABEL: Record<string, string> = {
  bank: "Bank",
  cash: "Kas",
  payable: "Hutang",
};

/** Regex untuk input frontend (sama dgn schema backend). */
export const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{1,19}$/;
export const AMOUNT_RE = /^\d{1,16}(\.\d{1,2})?$/;
export const RATE_RE = /^\d{1,5}(\.\d{1,4})?$/;
export const INT_RE = /^\d+$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const PERIOD_KEY_RE = /^\d{4}-\d{2}$/;
