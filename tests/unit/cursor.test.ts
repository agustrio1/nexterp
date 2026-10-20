import { describe, expect, it } from "vitest";

import { z } from "zod";

import { decodeCursor, encodeCursor, keysetPage, keysetSchema } from "@/server/cursor";
import { AppError } from "@/server/errors";

/**
 * Unit test helper keyset pagination (Tahap 10C).
 *
 * Kontrak yang dijamin:
 * - `keysetSchema`: limit 1..100 default 20, cursor opsional opaque string max 400.
 * - `encodeCursor`/`decodeCursor`: round-trip stabil, base64url (tanpa `+/=`),
 *   gagal -> AppError VALIDATION_FAILED dengan path "cursor".
 * - `keysetPage`: `hasMore` murni dari `rows.length > limit`; `nextCursor`
 *   hanya muncul saat masih ada baris tersisa.
 *
 * Kenapa ini penting: tiga endpoint (jobs/users/exchange-rates) memakai codec
 * yang sama — bug di sini = bug di semua paginasi. Test ini murni (tanpa DB).
 */

const tupleSchema = z.object({ t: z.string(), i: z.uuid() });
const UUID_A = "00000000-0000-4000-8000-00000000000a";

/* ------------------------------------------------------------------ */
/* keysetSchema — kontrak query string                                 */
/* ------------------------------------------------------------------ */

describe("keysetSchema (query paginasi)", () => {
  it("default limit=20 saat tidak diberi", () => {
    expect(keysetSchema.parse({})).toEqual({ limit: 20 });
  });

  it("limit coerce dari string angka", () => {
    expect(keysetSchema.parse({ limit: "50" }).limit).toBe(50);
  });

  it("limit < 1 ditolak", () => {
    expect(() => keysetSchema.parse({ limit: 0 })).toThrow();
    expect(() => keysetSchema.parse({ limit: -1 })).toThrow();
  });

  it("limit > 100 ditolak (proteksi DB)", () => {
    expect(() => keysetSchema.parse({ limit: 101 })).toThrow();
    expect(() => keysetSchema.parse({ limit: "9999" })).toThrow();
  });

  it("limit non-integer ditolak", () => {
    expect(() => keysetSchema.parse({ limit: 10.5 })).toThrow();
  });

  it("cursor string 1..400 diterima; >400 ditolak; string kosong ditolak", () => {
    expect(keysetSchema.parse({ cursor: "abc" }).cursor).toBe("abc");
    expect(() => keysetSchema.parse({ cursor: "" })).toThrow();
    expect(() => keysetSchema.parse({ cursor: "x".repeat(401) })).toThrow();
  });

  it("cursor tidak ada -> undefined (bedakan dengan null/empty)", () => {
    expect(keysetSchema.parse({}).cursor).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* encodeCursor / decodeCursor — round-trip & kegagalan               */
/* ------------------------------------------------------------------ */

describe("encodeCursor / decodeCursor", () => {
  it("round-trip tuple stabil (encode -> decode -> sama dengan input)", () => {
    const tuple = { t: "2026-10-20T00:00:00.000Z", i: UUID_A };
    const encoded = encodeCursor(tuple);
    const decoded = decodeCursor(encoded, tupleSchema);
    expect(decoded).toEqual(tuple);
  });

  it("encoded memakai base64url (tanpa +, /, =)", () => {
    // Base64url RFC 4648 §5 mengganti `+ /` dengan `- _` dan membuang padding `=`.
    // Kita cukup verifikasi output hanya memuat karakter url-safe.
    const encoded = encodeCursor({ t: "~~~", i: UUID_A });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("decode base64 bukan JSON -> AppError VALIDATION_FAILED path=cursor", () => {
    // "!!!" bukan base64 valid; Buffer.from(..., "base64url") menghasilkan byte acak,
    // JSON.parse gagal -> harus dilempar AppError, bukan SyntaxError mentah.
    let err: unknown;
    try {
      decodeCursor("!!!!bukan-cursor!!!!", tupleSchema);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("VALIDATION_FAILED");
    expect((err as AppError).details?.[0]?.path).toBe("cursor");
  });

  it("decode JSON tapi tuple tidak cocok schema -> AppError VALIDATION_FAILED", () => {
    // tuple valid JSON tapi `i` bukan UUID -> schema reject.
    const raw = Buffer.from(JSON.stringify({ t: "x", i: "not-uuid" }), "utf8").toString(
      "base64url",
    );
    let err: unknown;
    try {
      decodeCursor(raw, tupleSchema);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("VALIDATION_FAILED");
    expect((err as AppError).details?.[0]?.path).toBe("cursor");
  });

  it("decode field hilang -> AppError VALIDATION_FAILED", () => {
    const raw = Buffer.from(JSON.stringify({ t: "only-t" }), "utf8").toString("base64url");
    expect(() => decodeCursor(raw, tupleSchema)).toThrowError(AppError);
  });
});

/* ------------------------------------------------------------------ */
/* keysetPage — bentuk halaman                                         */
/* ------------------------------------------------------------------ */

type Row = { id: string; at: string };

describe("keysetPage (bentuk halaman)", () => {
  const cursorOf = (r: Row) => ({ t: r.at, i: r.id });
  const rows = (n: number): Row[] =>
    Array.from({ length: n }, (_, i) => ({ id: UUID_A, at: `2026-01-0${i + 1}T00:00:00.000Z` }));

  it("rows < limit -> hasMore=false, nextCursor=null", () => {
    const page = keysetPage(rows(3), 10, cursorOf);
    expect(page.items).toHaveLength(3);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it("rows == limit -> hasMore=false (caller harus request limit+1)", () => {
    const page = keysetPage(rows(5), 5, cursorOf);
    expect(page.items).toHaveLength(5);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it("rows == limit+1 -> hasMore=true, items di-slice ke limit, cursor dari baris terakhir yang tersimpan", () => {
    const source = rows(6); // limit=5 -> ambil 6 sebagai probe
    const page = keysetPage(source, 5, cursorOf);
    expect(page.items).toHaveLength(5);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).not.toBeNull();
    // Round-trip: cursor harus mengarah ke baris terakhir items yang tersimpan.
    const nextCursor = page.nextCursor;
    if (typeof nextCursor !== "string") throw new Error("nextCursor seharusnya string");
    const decoded = decodeCursor(nextCursor, tupleSchema);
    expect(decoded.t).toBe(source[4]?.at);
    expect(decoded.i).toBe(source[4]?.id);
  });

  it("rows kosong -> items=[], hasMore=false, nextCursor=null", () => {
    const page = keysetPage([], 10, cursorOf);
    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it("tidak memutasi array input", () => {
    const source = rows(3);
    const snapshot = [...source];
    keysetPage(source, 2, cursorOf);
    expect(source).toEqual(snapshot);
    expect(source).toHaveLength(3);
  });
});
