import Decimal from "decimal.js";

/**
 * Util uang dan kuantitas. Seluruh perhitungan nominal HARUS lewat file ini.
 * Memakai klon Decimal terisolasi supaya konfigurasi tidak bocor ke pustaka lain.
 * Pembulatan: ROUND_HALF_UP (0,5 dibulatkan menjauhi nol).
 */
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type Money = Decimal;
export type MoneyInput = string | number | Decimal | null | undefined;

/** Jumlah desimal standar untuk nominal uang (sesuai numeric(18,2)). */
export const MONEY_DP = 2;

/**
 * Mengubah masukan menjadi Decimal.
 * - null/undefined/"" dianggap 0
 * - number desimal (mis. 0.1) ditolak; gunakan string agar presisi terjaga
 */
export function dec(value: MoneyInput): Money {
  if (value === null || value === undefined || value === "") return new D(0);

  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new TypeError(
      "Nominal bertipe number hanya boleh bilangan bulat. Gunakan string untuk nilai desimal.",
    );
  }

  const result = new D(value);
  if (!result.isFinite()) {
    throw new TypeError("Nominal tidak valid.");
  }
  return result;
}

export function add(...values: MoneyInput[]): Money {
  return values.reduce<Money>((acc, value) => acc.plus(dec(value)), new D(0));
}

export function sum(values: readonly MoneyInput[]): Money {
  return add(...values);
}

export function sub(a: MoneyInput, b: MoneyInput): Money {
  return dec(a).minus(dec(b));
}

export function mul(a: MoneyInput, b: MoneyInput): Money {
  return dec(a).times(dec(b));
}

export function div(a: MoneyInput, b: MoneyInput): Money {
  const divisor = dec(b);
  if (divisor.isZero()) {
    throw new RangeError("Pembagian dengan nol.");
  }
  return dec(a).div(divisor);
}

/** Membulatkan ke `dp` desimal (default 2) dan mengembalikan Decimal. */
export function round(value: MoneyInput, dp: number = MONEY_DP): Money {
  return dec(value).toDecimalPlaces(dp, D.ROUND_HALF_UP);
}

/** Membandingkan: -1 jika a < b, 0 jika sama, 1 jika a > b. */
export function cmp(a: MoneyInput, b: MoneyInput): -1 | 0 | 1 {
  return dec(a).comparedTo(dec(b)) as -1 | 0 | 1;
}

export function isZero(value: MoneyInput): boolean {
  return dec(value).isZero();
}

/**
 * String siap simpan ke kolom numeric: dibulatkan dan selalu memuat `dp` desimal.
 * Contoh: toDb("1234.5") => "1234.50"
 */
export function toDb(value: MoneyInput, dp: number = MONEY_DP): string {
  return dec(value).toFixed(dp, D.ROUND_HALF_UP);
}

/**
 * Memeriksa jurnal seimbang: total debit sama dengan total kredit setelah
 * masing-masing dibulatkan ke 2 desimal.
 */
export function isBalanced(debits: readonly MoneyInput[], credits: readonly MoneyInput[]): boolean {
  return round(sum(debits)).equals(round(sum(credits)));
}

/**
 * Format tampilan gaya Indonesia: "Rp 1.234.567,89". Hanya untuk tampilan,
 * jangan dipakai untuk menyimpan atau menghitung.
 */
export function formatMoney(
  value: MoneyInput,
  options: { symbol?: string; decimals?: number } = {},
): string {
  const { symbol = "Rp", decimals = MONEY_DP } = options;

  const fixed = dec(value).toFixed(decimals, D.ROUND_HALF_UP);
  const negative = fixed.startsWith("-") && !new D(fixed).isZero();
  const unsigned = fixed.startsWith("-") ? fixed.slice(1) : fixed;

  const [integerPart = "0", fractionPart] = unsigned.split(".");
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  return `${negative ? "-" : ""}${symbol} ${grouped}${fractionPart ? `,${fractionPart}` : ""}`;
}