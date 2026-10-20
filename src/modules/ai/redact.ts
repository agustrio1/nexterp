import type { CsvRow } from "@/modules/reporting/csv";

import type { AnalysisOutcome } from "./analytics";

/* ------------------------------------------------------------------ */
/* Minimisasi data sebelum masuk prompt AI (Tahap 9C).                  */
/* Free tier Google memakai konten untuk meningkatkan produk, jadi yang  */
/* dikirim ke provider hanyalah: label laporan, filter (parameter), dan   */
/* maksimal TOP_N baris dengan kolom identitas/PII dibuang. Angka tetap   */
/* berasal dari service; AI hanya mendeskripsikan potongan yang sudah     */
/* disaring ini.                                                           */
/* ------------------------------------------------------------------ */

export const TOP_N_ROWS = 8;
const MAX_CELL_CHARS = 120;

/** Kolom identitas teknis (pk/fk/uuid) — tak berguna untuk ringkasan & sensitif. */
const IDENTIFIER_KEY = /(^|_)id$|^id$|uuid/i;
/** Kolom PII/rahasia — tak boleh dikirim ke provider. */
const PII_KEY =
  /(email|phone|mobile|telepon|alamat|address|npwp|nik|rekening|account_?number|password|secret|token|api_?key|memo|catatan|notes?$|contact)/i;
/** Kolom bernama orang — dibuang khusus untuk laporan yang memuat data personal. */
const PERSON_KEY = /(nama|name|employee|karyawan|pegawai|candidate|pelamar)/i;

/** Laporan yang barisnya memuat identitas orang (bukan sekadar label akun/departemen). */
const PERSONAL_REPORT_KEYS = new Set([
  "hr-attendance",
  "hr-leave-balances",
  "hr-headcount",
  "payslip-register",
  "payroll-by-department",
]);

function clampValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > MAX_CELL_CHARS ? `${value.slice(0, MAX_CELL_CHARS)}…` : value;
  }
  if (value !== null && typeof value === "object") {
    const json = JSON.stringify(value);
    return json.length > MAX_CELL_CHARS ? `${json.slice(0, MAX_CELL_CHARS)}…` : value;
  }
  return value;
}

/** Buang kolom identitas/PII (dan kolom nama orang bila laporan personal). */
export function redactRow(row: CsvRow, personalData: boolean): CsvRow {
  const out: CsvRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (IDENTIFIER_KEY.test(key) || PII_KEY.test(key)) continue;
    if (personalData && PERSON_KEY.test(key)) continue;
    out[key] = clampValue(value);
  }
  return out;
}

export type SummaryData = {
  reportKey: string;
  reportLabel: string;
  /** Parameter laporan (tanggal/cabang) — echo filter, bukan nilai baris. */
  filter: Record<string, unknown>;
  rowCount: number;
  sample: CsvRow[];
};

/** Susun blok data minimal untuk prompt ringkasan. */
export function buildSummaryData(input: {
  reportKey: string;
  reportLabel: string;
  filter: Record<string, unknown>;
  rows: CsvRow[];
  topN?: number;
}): SummaryData {
  const personalData = PERSONAL_REPORT_KEYS.has(input.reportKey);
  const topN = input.topN ?? TOP_N_ROWS;
  return {
    reportKey: input.reportKey,
    reportLabel: input.reportLabel,
    filter: input.filter,
    rowCount: input.rows.length,
    sample: input.rows.slice(0, topN).map((row) => redactRow(row, personalData)),
  };
}

/* ------------------------------------------------------------------ */
/* Minimisasi hasil ANALISIS (Tahap 9D).                               */
/* Analisis dibatasi ke domain finance/sales/inventory — tidak memuat    */
/* baris personal karyawan — jadi `personalData=false` (kolom id/PII     */
/* tetap dibuang, nama akun/produk bisnis dipertahankan agar penjelasan   */
/* bermakna). `metrics` sudah agregat numerik dari service deterministik.  */
/* ------------------------------------------------------------------ */

export type AnalysisSummaryData = {
  analysisKey: string;
  analysisLabel: string;
  /** Parameter analisis (tanggal/uuid/ambang) — echo filter, bukan nilai baris. */
  params: Record<string, unknown>;
  metrics: Record<string, string | number>;
  series: CsvRow[];
  flags: CsvRow[];
};

/** Susun blok data minimal untuk prompt penjelasan analisis. */
export function redactAnalysis(outcome: AnalysisOutcome, topN: number = TOP_N_ROWS): AnalysisSummaryData {
  return {
    analysisKey: outcome.analysisKey,
    analysisLabel: outcome.analysisLabel,
    params: outcome.params,
    metrics: outcome.metrics,
    series: (outcome.series ?? []).slice(0, topN).map((row) => redactRow(row, false)),
    flags: (outcome.flags ?? []).slice(0, topN).map((row) => redactRow(row, false)),
  };
}
