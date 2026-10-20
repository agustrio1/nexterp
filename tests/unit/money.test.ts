import { describe, expect, it } from "vitest";

import {
  add,
  cmp,
  dec,
  div,
  formatMoney,
  isBalanced,
  isZero,
  MONEY_DP,
  mul,
  round,
  sub,
  sum,
  toDb,
} from "@/lib/money";

/**
 * Unit test util uang berbasis `decimal.js` — sumber kebenaran untuk semua
 * perhitungan nominal ERP (Tahap 10A). Memastikan:
 * - presisi desimal penuh (tidak ada float error),
 * - pembulatan ROUND_HALF_UP pada 2 dp default,
 * - penolakan number desimal (hanya integer aman lewat API `dec`),
 * - format tampilan gaya Indonesia.
 */

describe("money.dec", () => {
  it("menganggap null/undefined/'' sebagai nol", () => {
    expect(dec(null).toString()).toBe("0");
    expect(dec(undefined).toString()).toBe("0");
    expect(dec("").toString()).toBe("0");
  });

  it("menerima string desimal tanpa kehilangan presisi", () => {
    expect(dec("1234567.89").toString()).toBe("1234567.89");
    expect(dec("0.10").toString()).toBe("0.1");
  });

  it("menolak number desimal (harus string)", () => {
    expect(() => dec(0.1 as unknown as string)).toThrow(TypeError);
    expect(() => dec(1.5)).toThrow(/string untuk nilai desimal/i);
  });

  it("menerima number integer", () => {
    expect(dec(42).toString()).toBe("42");
    expect(dec(-7).toString()).toBe("-7");
  });

  it("menolak NaN/Infinity", () => {
    expect(() => dec(Number.NaN)).toThrow(TypeError);
    expect(() => dec("NaN")).toThrow(TypeError);
    expect(() => dec("Infinity")).toThrow(TypeError);
  });
});

describe("money aritmetika", () => {
  it("add/sub/mul/div presisi penuh", () => {
    expect(add("0.1", "0.2").toString()).toBe("0.3");
    expect(sub("1000.00", "0.01").toString()).toBe("999.99");
    expect(mul("1.5", "2").toString()).toBe("3");
    expect(div("10", "4").toString()).toBe("2.5");
  });

  it("sum terhadap array kosong = 0", () => {
    expect(sum([]).toString()).toBe("0");
  });

  it("div oleh nol melempar RangeError", () => {
    expect(() => div("10", "0")).toThrow(RangeError);
    expect(() => div("10", "0.00")).toThrow(/Pembagian dengan nol/);
  });
});

describe("money.round + toDb", () => {
  it("default 2 dp ROUND_HALF_UP", () => {
    // 0.5 dibulatkan menjauhi nol.
    expect(round("1.005").toString()).toBe("1.01");
    expect(round("1.015").toString()).toBe("1.02");
    expect(round("-1.005").toString()).toBe("-1.01");
    expect(round("1.004").toString()).toBe("1");
  });

  it("dp kustom dihormati", () => {
    expect(round("1.234567", 4).toString()).toBe("1.2346");
  });

  it("toDb selalu memuat 2 desimal", () => {
    expect(toDb("1234.5")).toBe("1234.50");
    expect(toDb("1")).toBe("1.00");
    expect(toDb("0.005")).toBe("0.01");
    expect(toDb("-1.015")).toBe("-1.02");
  });

  it("MONEY_DP = 2 (konsisten dengan numeric(18,2))", () => {
    expect(MONEY_DP).toBe(2);
  });
});

describe("money.cmp / isZero / isBalanced", () => {
  it("cmp mengembalikan -1/0/1", () => {
    expect(cmp("1", "2")).toBe(-1);
    expect(cmp("2", "2")).toBe(0);
    expect(cmp("3", "2")).toBe(1);
    expect(cmp("-1", "0")).toBe(-1);
  });

  it("isZero menghormati representasi berbeda", () => {
    expect(isZero("0.00")).toBe(true);
    expect(isZero("0.001")).toBe(false);
    expect(isZero(null)).toBe(true);
  });

  it("isBalanced: debit = kredit setelah pembulatan", () => {
    expect(isBalanced(["100.00", "200.00"], ["300.00"])).toBe(true);
    // 100.005 dibulatkan ke 100.01 (ROUND_HALF_UP menjauhi nol) -> tidak sama dengan 100.00.
    expect(isBalanced(["100.00"], ["100.005"])).toBe(false);
    expect(isBalanced(["100.00"], ["100.01"])).toBe(false);
    // 0.001 -> 0.00 setelah round (satu sisi), tetap seimbang.
    expect(isBalanced(["0.001"], ["0"])).toBe(true);
    expect(isBalanced([], [])).toBe(true);
  });
});

describe("money.formatMoney", () => {
  it("format Indonesia dengan pemisah titik & koma desimal", () => {
    expect(formatMoney("1234567.89")).toBe("Rp 1.234.567,89");
    expect(formatMoney("1000")).toBe("Rp 1.000,00");
    expect(formatMoney("0")).toBe("Rp 0,00");
  });

  it("negatif dengan tanda - di depan", () => {
    expect(formatMoney("-1234.50")).toBe("-Rp 1.234,50");
  });

  it("symbol kustom (format tetap gaya Indonesia: koma desimal)", () => {
    expect(formatMoney("1.5", { symbol: "$" })).toBe("$ 1,50");
  });

  it("minus nol tidak dianggap negatif", () => {
    // dec("-0.00") -> isZero true, tidak tanda minus.
    expect(formatMoney("-0.00")).toBe("Rp 0,00");
  });
});
