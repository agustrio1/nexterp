import type { SummaryData } from "./redact";

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
