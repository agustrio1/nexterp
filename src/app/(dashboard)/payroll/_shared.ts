/**
 * Helper bersama halaman Payroll: memuat daftar referensi (periode, komponen,
 * struktur, aturan statutory) untuk mapping nama di tabel & opsi select, serta
 * label status/kategori seragam. Setiap fetch gagal (mis. izin tidak ada) jatuh
 * ke array kosong — halaman tetap tampil dengan "—" pada kolom terkait.
 */
import { formatMoney } from "@/lib/money";

export type PeriodRef = { id: string; code: string; name: string; status: string };
export type ComponentRef = { id: string; code: string; name: string; kind: string; basis: string; isActive: boolean };
export type StructureRef = { id: string; code: string; name: string; payFrequency: string; isActive: boolean };
export type StatutoryRef = { id: string; code: string; name: string; kind: string; isActive: boolean };

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

export async function fetchPeriods(): Promise<PeriodRef[]> {
  return getJson<PeriodRef>("/api/payroll/periods");
}

export async function fetchComponents(): Promise<ComponentRef[]> {
  return getJson<ComponentRef>("/api/payroll/components?isActive=true");
}

export async function fetchAllComponents(): Promise<ComponentRef[]> {
  return getJson<ComponentRef>("/api/payroll/components");
}

export async function fetchStructures(): Promise<StructureRef[]> {
  return getJson<StructureRef>("/api/payroll/structures");
}

export async function fetchStatutoryRules(): Promise<StatutoryRef[]> {
  return getJson<StatutoryRef>("/api/payroll/statutory");
}

export function toMap<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((i) => [i.id, i]));
}

/** Format nominal uang gaya Indonesia; pakai string desimal dari API apa adanya. */
export function rp(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return formatMoney(value);
}

export const RUN_STATUS_LABEL: Record<string, string> = {
  draft: "Draf",
  calculated: "Terhitung",
  approved: "Disetujui",
  posted: "Diposting",
  cancelled: "Dibatalkan",
  reversed: "Direversal",
};

export const PERIOD_STATUS_LABEL: Record<string, string> = {
  draft: "Draf",
  finalized: "Difinalisasi",
  posted: "Diposting",
  closed: "Ditutup",
};

export const COMPONENT_KIND_LABEL: Record<string, string> = {
  earning: "Penerimaan",
  deduction: "Potongan",
};

export const COMPONENT_BASIS_LABEL: Record<string, string> = {
  fixed: "Nominal Tetap",
  percentage_of_base: "Persen dari Gaji Pokok",
  statutory: "Statutory",
  attendance: "Kehadiran",
};

export const STATUTORY_KIND_LABEL: Record<string, string> = {
  pph21: "PPh 21",
  bpjs_kesehatan: "BPJS Kesehatan",
  bpjs_jht: "BPJS JHT",
  bpjs_jp: "BPJS JP",
  bpjs_kk: "BPJS KK",
  bpjs_jkm: "BPJS JKM",
  other: "Lainnya",
};

export const PARTY_LABEL: Record<string, string> = {
  employee: "Karyawan",
  employer: "Perusahaan",
  both: "Keduanya",
};

export const PAY_FREQUENCY_LABEL: Record<string, string> = {
  monthly: "Bulanan",
  bimonthly: "Dwibulanan",
  weekly: "Mingguan",
};

export const RUN_STATUS_STYLE: Record<string, string> = {
  draft: "rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  calculated: "rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  approved: "rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300",
  posted: "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300",
  cancelled: "rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300",
  reversed: "rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900 dark:text-amber-300",
};

export const PERIOD_STATUS_STYLE: Record<string, string> = {
  draft: "rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  finalized: "rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  posted: "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300",
  closed: "rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
};

/** Kode Regex untuk input frontend (sama dgn schema backend). */
export const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{1,19}$/;
export const AMOUNT_RE = /^\d{1,16}(\.\d{1,2})?$/;
export const RATE_RE = /^\d{1,5}(\.\d{1,4})?$/;
