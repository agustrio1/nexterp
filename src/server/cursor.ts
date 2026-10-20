import { z } from "zod";

import { validationFailed } from "@/server/errors";

/**
 * Helper keyset pagination generik (Tahap 10C).
 *
 * Kenapa keyset dan bukan OFFSET:
 * - OFFSET tetap memindai baris yang dibuang — O(n) dan bisa "page drift"
 *   saat baris baru masuk di antara halaman.
 * - Keyset (cursor = tuple pembanding) berjalan O(log n) lewat indeks
 *   `(col, id)` — aman untuk daftar tumbuh (job_runs, exchange_rates, users).
 *
 * Bentuk cursor: base64url(JSON) dengan field pendek (`d`,`i`,`t`) — compact,
 * opaque (klien tidak boleh menafsirkan isi), dan tetap string di query URL.
 * Bila kebutuhan audit menuntut keterbacaan, gunakan variant `plain` dengan
 * prefix ter-signature — di luar scope Tahap 10C.
 *
 * Aturan: caller WAJIB punya urutan kanonik (kolom sort + id tiebreaker),
 * dan encode/decode memakai tuple yang SAMA. Tidak ada validasi business
 * logic di sini — hanya codec + schema string.
 */

/** Schema satu halaman keyset (query string dari klien). */
export const keysetSchema = z.object({
  /** Hasil maksimal per halaman; 1..100; default 20. */
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** Cursor opaque base64url dari respons sebelumnya. `null` = halaman pertama. */
  cursor: z.string().min(1).max(400).optional(),
});

export type KeysetQuery = z.output<typeof keysetSchema>;

/** Serialisasi tuple cursor menjadi base64url opaque string. */
export function encodeCursor(tuple: Record<string, string>): string {
  return Buffer.from(JSON.stringify(tuple), "utf8").toString("base64url");
}

/**
 * Deserialize + validasi cursor terhadap `schema` milik caller.
 * Kegagalan selalu -> AppError VALIDATION_FAILED 422 (path "cursor"),
 * bukan 500 — supaya klien salah kirim cursor tidak mengira server rusak.
 */
export function decodeCursor<T>(raw: string, schema: z.ZodType<T>): T {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw validationFailed([{ path: "cursor", message: "Cursor tidak valid." }]);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw validationFailed([{ path: "cursor", message: "Cursor tidak valid." }]);
  }
  return parsed.data;
}

/**
 * Helper bentuk response keyset — konsisten dengan pola yang sudah dipakai
 * jurnal 4E dan laporan-laporan lain. `hasMore` dihitung dari `limit + 1`
 * yang diminta ke DB; caller harus slice sebelum memanggil ini.
 */
export function keysetPage<T>(
  rows: readonly T[],
  limit: number,
  cursorOf: (row: T) => Record<string, string>,
): { items: T[]; nextCursor: string | null; hasMore: boolean } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : [...rows];
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(cursorOf(last)) : null,
    hasMore,
  };
}
