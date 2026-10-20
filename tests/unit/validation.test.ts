import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  idParamsSchema,
  isoDateSchema,
  moneyString,
  parseWith,
  signedMoneyString,
  uuidSchema,
} from "@/server/validation";
import { AppError } from "@/server/errors";

/**
 * Unit test skema umum + parser murni (Tahap 3 -> diuji 10A).
 * `parseBody`/`parseQuery`/`parseParams` butuh `Request` — tidak diuji di sini
 * karena jalur HTTP sudah dilindungi `test-security.ts` (integrasi rollback).
 * Fokus: `parseWith`, konvensi `moneyString`, `signedMoneyString`, `isoDateSchema`.
 *
 * Catatan 10C: `paginationSchema`/`toLimitOffset` sudah dihapus dari kode produksi;
 * paginasi modern memakai keyset opaque (`@/server/cursor`) — lihat `cursor.test.ts`.
 */

describe("parseWith", () => {
  it("mengembalikan data tervalidasi", () => {
    expect(parseWith(z.object({ a: z.number() }), { a: 1 })).toEqual({ a: 1 });
  });

  it("kegagalan -> AppError VALIDATION_FAILED (422) + details", () => {
    let caught: unknown;
    try {
      parseWith(z.object({ a: z.number() }), { a: "x" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe("VALIDATION_FAILED");
    expect((caught as AppError).status).toBe(422);
    expect((caught as AppError).details?.[0]?.path).toBe("a");
  });
});

describe("uuidSchema", () => {
  it("UUID v4 valid lolos", () => {
    expect(uuidSchema.parse("00000000-0000-4000-8000-000000000001")).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
  });

  it("non-UUID ditolak", () => {
    expect(() => uuidSchema.parse("bukan-uuid")).toThrow();
    expect(() => uuidSchema.parse("")).toThrow();
  });
});

describe("idParamsSchema", () => {
  it("{ id: uuid } lolos", () => {
    expect(idParamsSchema.parse({ id: "00000000-0000-4000-8000-000000000001" })).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
    });
  });

  it("id non-UUID ditolak", () => {
    expect(() => idParamsSchema.parse({ id: "abc" })).toThrow();
  });

  it("field asing ditolak (skema default strip, bukan strict — hanya memastikan id)", () => {
    // Field asing tidak memengaruhi hasil; ini perilaku standar Zod object.
    const result = idParamsSchema.safeParse({ id: "00000000-0000-4000-8000-000000000001", extra: 1 });
    expect(result.success).toBe(true);
  });
});

describe("isoDateSchema", () => {
  it("YYYY-MM-DD valid lolos", () => {
    expect(isoDateSchema.parse("2026-10-20")).toBe("2026-10-20");
    // Batas kalender (29 Feb tahun kabisat):
    expect(isoDateSchema.parse("2024-02-29")).toBe("2024-02-29");
  });

  it("format salah ditolak", () => {
    expect(() => isoDateSchema.parse("20-10-2026")).toThrow();
    expect(() => isoDateSchema.parse("2026/10/20")).toThrow();
    expect(() => isoDateSchema.parse("2026-10")).toThrow();
    // Tanggal tak ada di kalender (29 Feb non-kabisat):
    expect(() => isoDateSchema.parse("2025-02-29")).toThrow();
  });
});

describe("moneyString (non-negatif, max 16 digit + 2 desimal)", () => {
  it("nilai valid lolos", () => {
    expect(moneyString.parse("0")).toBe("0");
    expect(moneyString.parse("100.00")).toBe("100.00");
    expect(moneyString.parse("9999999999999999.99")).toBe("9999999999999999.99");
  });

  it("ditolak: negatif, > 2 desimal, > 16 digit integer, string kosong", () => {
    expect(() => moneyString.parse("-1")).toThrow();
    expect(() => moneyString.parse("1.234")).toThrow();
    expect(() => moneyString.parse("12345678901234567")).toThrow(); // 17 digit integer
    expect(() => moneyString.parse("")).toThrow();
    expect(() => moneyString.parse("abc")).toThrow();
  });

  it("desimal tanpa digit integer ditolak (harus '0.xx')", () => {
    // Regex `/^\d{1,16}(\.\d{1,2})?$/` mensyaratkan minimal 1 digit integer.
    expect(() => moneyString.parse(".50")).toThrow();
  });
});

describe("signedMoneyString (boleh negatif)", () => {
  it("negatif lolos", () => {
    expect(signedMoneyString.parse("-100.00")).toBe("-100.00");
    expect(signedMoneyString.parse("-0.01")).toBe("-0.01");
  });

  it("tetap batasi desimal 2 dan integer 16", () => {
    expect(() => signedMoneyString.parse("-1.234")).toThrow();
    expect(() => signedMoneyString.parse("-12345678901234567")).toThrow();
  });
});
