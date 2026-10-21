/**
 * Helper bersama halaman Proyek: label status seragam & pemendek nama.
 * Referensi karyawan/cabang/departemen memakai useHrRefs() (hook bersama).
 */
import { formatMoney } from "@/lib/money";

export function rp(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return formatMoney(value);
}

export const PROJECT_STATUS_LABEL: Record<string, string> = {
  planning: "Perencanaan",
  in_progress: "Berjalan",
  on_hold: "Ditahan",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

export const PROJECT_STATUS_STYLE: Record<string, string> = {
  planning: "rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  in_progress: "rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  on_hold: "rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  completed: "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300",
  cancelled: "rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300",
};

export const TASK_STATUS_LABEL: Record<string, string> = {
  pending: "Menunggu",
  in_progress: "Berjalan",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

export const TASK_STATUS_STYLE: Record<string, string> = {
  pending: "rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  in_progress: "rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  completed: "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300",
  cancelled: "rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300",
};

export const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{1,19}$/;
export const AMOUNT_RE = /^\d{1,16}(\.\d{1,2})?$/;
export const RATE_RE = /^\d{1,5}(\.\d{1,4})?$/;
export const INT_RE = /^\d+$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const PERIOD_KEY_RE = /^\d{4}-\d{2}$/;
