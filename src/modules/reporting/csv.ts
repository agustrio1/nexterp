/* ------------------------------------------------------------------ */
/* Konversi hasil laporan (baris objek) menjadi CSV UTF-8 (Tahap 8D).  */
/* Pemisah koma, baris CRLF, tanpa BOM. Nominal sudah string desimal   */
/* dari money.ts — di sini tidak ada pembulatan/apar kode baru.        */
/* ------------------------------------------------------------------ */

export type CsvRow = Record<string, unknown>;

function collectHeaders(rows: readonly CsvRow[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) seen.add(key);
    }
  }
  return [...seen];
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function escape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Baris -> CSV dengan header hasil union key (urut kemunculan pertama). */
export function toCsv(rows: readonly CsvRow[]): string {
  const headers = collectHeaders(rows);
  const lines = [headers.map(escape).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(cell(row[h]))).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

export const CSV_CONTENT_TYPE = "text/csv; charset=utf-8";
