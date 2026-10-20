import type { AnalysisSummaryData, SummaryData } from "./redact";

/* ------------------------------------------------------------------ */
/* Template prompt asisten laporan (Tahap 9C).                          */
/* Prinsip: model TIDAK PERNAH disuruh menulis SQL atau menghitung angka. */
/* Ia hanya (1) memilih reportKey dari daftar yang DIIZINKAN pengguna,   */
/* (2) menyusun parameter, lalu (3) menarasikan data yang sudah dihitung */
/* service deterministik. Katalog di sini murni metadata (key + label).   */
/* ------------------------------------------------------------------ */

export type CatalogLite = { key: string; label: string };

export const CLASSIFY_SYSTEM = `Anda asisten pelaporan ERP. Tugas Anda: memilih SATU laporan dari daftar yang diizinkan pengguna untuk menjawab pertanyaannya, lalu menentukan parameter query-nya.
Aturan keras:
- Hanya boleh memakai reportKey yang ada di DAFTAR. Bila tidak ada yang cocok, kembalikan reportKey "none".
- DILARANG menulis SQL, DILARANG mengarang angka, DILARANG memakai laporan di luar daftar.
- "query" adalah parameter laporan, contoh {"from":"2026-01-01","to":"2026-01-31"} (rentang), {"asOf":"YYYY-MM-DD"} (posisi), {"branchId":"<uuid>"} (cabang) bila relevan. Kosongkan {} bila tidak yakin.
- Balas HANYA JSON tanpa teks lain: {"reportKey": string, "query": object, "rationale": string}.`;

export const SUMMARIZE_SYSTEM = `Anda meringkas hasil laporan ERP untuk pengguna dalam Bahasa Indonesia yang ringkas dan netral.
Aturan keras:
- SEMUA angka sudah disediakan pada bagian DATA. DILARANG menghitung, menjumlah, atau mengarang angka apa pun.
- AI bukan sumber kebenaran. Sebutkan nama laporan, periode/filter, dan bahwa angka berasal dari laporan resmi sistem.
- Jangan mengulang kolom yang sudah dibuang; jangan meminta data tambahan.`;

/** Prompt klasifikasi: katalog terizinkan + pertanyaan. Tanpa data bisnis. */
export function buildClassifyPrompt(question: string, catalog: readonly CatalogLite[]): string {
  const lines = catalog.map((entry) => `- ${entry.key}: ${entry.label}`).join("\n");
  return `DAFTAR LAPORAN TERIZIN:\n${lines}\n\nPERTANYAAN PENGGUNA:\n${question}\n\nTentukan reportKey + query sebagai JSON.`;
}

/** Prompt ringkasan: pertanyaan + blok data yang sudah diminimasi (redact.ts). */
export function buildSummarizePrompt(question: string, data: SummaryData): string {
  return [
    `PERTANYAAN:\n${question}`,
    `LAPORAN: ${data.reportLabel} (key: ${data.reportKey})`,
    `FILTER: ${JSON.stringify(data.filter)}`,
    `JUMLAH BARIS: ${data.rowCount}`,
    `DATA (hasil laporan sistem, sudah disaring — jangan dihitung ulang):\n${JSON.stringify(data.sample)}`,
    `Buat ringkasan singkat.`,
  ].join("\n\n");
}

/* ------------------------------------------------------------------ */
/* Prompt asisten ANALISIS (Tahap 9D).                                  */
/* Sama seperti 9C: model hanya memilih SATU analysisKey dari daftar     */
/* yang diizinkan + menyusun parameter, lalu menarasikan metrik/seri     */
/* yang sudah dihitung deterministik. AI tidak menghitung/tidak SQL.      */
/* ------------------------------------------------------------------ */

export const ANALYZE_CLASSIFY_SYSTEM = `Anda asisten analitik ERP. Tugas Anda: memilih SATU jenis analisis dari daftar yang diizinkan pengguna, lalu menentukan parameternya.
Aturan keras:
- Hanya boleh memakai analysisKey yang ada di DAFTAR. Bila tidak ada yang cocok, kembalikan analysisKey "none".
- DILARANG menulis SQL, DILARANG mengarang angka, DILARANG memakai analisis di luar daftar.
- "params" adalah parameter analisis, contoh {"from":"2026-01-01","to":"2026-01-31"} atau {"fiscalYearId":"<uuid>"} untuk tren; {"budgetId":"<uuid>","variancePctThreshold":10} untuk varians anggaran; {} untuk analisis posisi kini. Kosongkan {} bila tidak yakin.
- Balas HANYA JSON tanpa teks lain: {"analysisKey": string, "params": object, "rationale": string}.`;

export const ANALYZE_EXPLAIN_SYSTEM = `Anda menjelaskan hasil analisis ERP (tren/anomali) dalam Bahasa Indonesia yang ringkas dan netral.
Aturan keras:
- SEMUA angka sudah tersedia di bagian METRIK/SERI/FLAGS. DILARANG menghitung, menjumlah, atau mengarang angka apa pun.
- AI bukan sumber kebenaran. Sebutkan nama analisis, periode/filter, dan bahwa angka berasal dari service deterministik sistem.
- Jelaskan arah (naik/turun/flat) atau anomali yang terdeteksi; jangan meminta data tambahan.`;

/** Prompt klasifikasi analisis: katalog terizinkan + pertanyaan. Tanpa data bisnis. */
export function buildAnalyzeClassifyPrompt(question: string, catalog: readonly CatalogLite[]): string {
  const lines = catalog.map((entry) => `- ${entry.key}: ${entry.label}`).join("\n");
  return `DAFTAR ANALISIS TERIZIN:\n${lines}\n\nPERTANYAAN PENGGUNA:\n${question}\n\nTentukan analysisKey + params sebagai JSON.`;
}

/** Prompt penjelasan analisis: pertanyaan + blok hasil deterministik yang sudah diminimasi. */
export function buildAnalyzeExplainPrompt(question: string, data: AnalysisSummaryData): string {
  return [
    `PERTANYAAN:\n${question}`,
    `ANALISIS: ${data.analysisLabel} (key: ${data.analysisKey})`,
    `PARAMETER: ${JSON.stringify(data.params)}`,
    `METRIK (dihitung service deterministik — jangan dihitung ulang):\n${JSON.stringify(data.metrics)}`,
    data.series.length > 0 ? `SERI:\n${JSON.stringify(data.series)}` : "SERI: (tidak ada)",
    data.flags.length > 0 ? `FLAGS ANOMALI:\n${JSON.stringify(data.flags)}` : "FLAGS ANOMALI: (tidak ada)",
    `Jelaskan singkat arah/anomali berdasarkan angka di atas.`,
  ].join("\n\n");
}
