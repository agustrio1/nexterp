import { z, ZodError } from "zod";
import { describe, expect, it } from "vitest";

import {
  AppError,
  businessRule,
  conflict,
  forbidden,
  normalizeError,
  notFound,
  rateLimited,
  unauthenticated,
  validationFailed,
} from "@/server/errors";

/**
 * Unit test normalisasi error (Tahap 3 -> diuji 10A).
 * `normalizeError` memetakan error apa pun menjadi AppError dengan kode baku.
 * Fokus pada:
 * - identifikasi SQLSTATE (unique/FK) lewat properti `code` atau `cause` berjenjang,
 * - error tak dikenal menjadi INTERNAL (pesan tidak membocorkan detail),
 * - ZodError -> VALIDATION_FAILED + details,
 * - AppError diteruskan apa adanya.
 *
 * `toErrorResponse` menghasilkan NextResponse.json — diuji lewat body parsing
 * standar; tidak ada DB/jaringan yang disentuh.
 */

describe("AppError factory helpers", () => {
  it("kode -> status HTTP sesuai peta", () => {
    expect(unauthenticated().status).toBe(401);
    expect(forbidden().status).toBe(403);
    expect(notFound().status).toBe(404);
    expect(conflict("x").status).toBe(409);
    expect(validationFailed([]).status).toBe(422);
    expect(businessRule("x").status).toBe(422);
    expect(rateLimited().status).toBe(429);
    expect(new AppError("INTERNAL", "x").status).toBe(500);
  });

  it("pesan default tidak bocorkan struktur internal", () => {
    expect(unauthenticated().message).toMatch(/belum masuk|sesi/);
    expect(forbidden().message).toMatch(/tidak memiliki izin/);
    expect(rateLimited().message).toMatch(/terlalu banyak/i);
  });

  it("details opsional disisipkan apa adanya", () => {
    const details = [{ path: "a.b", message: "butuh string" }];
    expect(validationFailed(details).details).toEqual(details);
  });
});

describe("normalizeError", () => {
  it("meneruskan AppError apa adanya (identity)", () => {
    const original = forbidden("custom");
    expect(normalizeError(original)).toBe(original);
  });

  it("ZodError -> VALIDATION_FAILED dengan details terpetakan", () => {
    // Generate ZodError nyata lewat z.string().parse(123) agar tipe cocok.
    let zod!: ZodError;
    try {
      z.string().parse(123);
    } catch (error) {
      zod = error as ZodError;
    }
    // Path array [] pada ZodError issue -> join(".") == "" -> path kosong.
    const e = normalizeError(zod);
    expect(e.code).toBe("VALIDATION_FAILED");
    expect(e.status).toBe(422);
    expect(e.details?.[0]?.path).toBe("");
    expect(e.details?.[0]?.message).toBeTypeOf("string");
  });

  it("ZodError dengan path berjenjang -> dot-notation", () => {
    let zod!: ZodError;
    try {
      z.object({ lines: z.array(z.object({ amount: z.string() })) }).parse({
        lines: [{ amount: 999 }],
      });
    } catch (error) {
      zod = error as ZodError;
    }
    const e = normalizeError(zod);
    expect(e.details?.[0]?.path).toBe("lines.0.amount");
  });

  it("SQLSTATE 23505 (unique) -> CONFLICT pesan aman", () => {
    const err = Object.assign(new Error("duplicate key"), { code: "23505" });
    const e = normalizeError(err);
    expect(e.code).toBe("CONFLICT");
    expect(e.message).toMatch(/sudah ada/i);
    // Pesan asli TIDAK dibocorkan.
    expect(e.message).not.toContain("duplicate key");
  });

  it("SQLSTATE 23503 (FK) -> CONFLICT pesan aman", () => {
    const err = Object.assign(new Error("violates fk"), { code: "23503" });
    const e = normalizeError(err);
    expect(e.code).toBe("CONFLICT");
    expect(e.message).toMatch(/terhubung|rujukan/);
  });

  it("SQLSTATE tersembunyi di `cause` berjenjang (Drizzle QueryFailedError)", () => {
    const inner = Object.assign(new Error("wrapped"), { code: "23505" });
    const outer = new Error("Drizzle wrapper", { cause: inner });
    const e = normalizeError(outer);
    expect(e.code).toBe("CONFLICT");
  });

  it("SQLSTATE lebih dari 4 level -> diabaikan (INTERNAL)", () => {
    // Depth cap 4 adalah keputusan sadar agar tidak infinite-loop pada objek besar.
    const deep = Object.assign(new Error("unique"), { code: "23505" });
    let wrapper: Error = deep;
    for (let i = 0; i < 5; i++) wrapper = new Error("l" + i, { cause: wrapper });
    expect(normalizeError(wrapper).code).toBe("INTERNAL");
  });

  it("code non-SQLSTATE (5 char) dianggap SQLSTATE — edge case dokumentasi", () => {
    // sqlState() hanya cek panjang 5 karakter — jadi kode PG kustom tetap terpetakan
    // bila kebetulan 23505/23503, dan jadi INTERNAL bila bukan.
    const err = Object.assign(new Error("boom"), { code: "XXYYY" });
    expect(normalizeError(err).code).toBe("INTERNAL");
  });

  it("error tak dikenal -> INTERNAL, pesan generik", () => {
    const e = normalizeError(new Error("raw driver stack trace should not leak"));
    expect(e.code).toBe("INTERNAL");
    expect(e.message).toBe("Terjadi kesalahan pada server.");
    expect(e.details).toBeUndefined();
  });

  it("error non-Error (string/number/null) -> INTERNAL", () => {
    expect(normalizeError("boom").code).toBe("INTERNAL");
    expect(normalizeError(42).code).toBe("INTERNAL");
    expect(normalizeError(null).code).toBe("INTERNAL");
  });
});
