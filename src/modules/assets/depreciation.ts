import type { DepreciationMethod } from "@/db/schema";
import { cmp, div, mul, sub, toDb } from "@/lib/money";

/**
 * Parameter penyusutan yang sudah di-resolve ( aset override -> kategori default ).
 * Seluruh nominal string desimal; pembulatan HALF_UP 2dp lewat money.ts.
 */
export type DepreciationParams = {
  method: DepreciationMethod;
  cost: string;
  /** Nilai residu ABSOLUT (bukan persen). */
  residualValue: string;
  /** Akumulasi penyusutan yang sudah dibukukan sebelumnya. */
  accumulated: string;
  /** Umur ekonomis dalam bulan (garis lurus). */
  usefulLifeMonths: number;
  /** Tarif % per periode untuk declining balance (mis. "2" = 2%). */
  decliningRatePercent: string | null;
  /** Total kapasitas satuan untuk units_of_production. */
  totalUnits: number | null;
  /** Pemakaian satuan pada periode berjalan. */
  periodUnits: number | null;
};

const minAmount = (a: string, b: string): string => (cmp(a, b) <= 0 ? a : b);

/**
 * Hitung penyusutan SATU periode. Tidak pernah melewati sisa yang dapat
 * disusutkan ( cost - residual - accumulated ) sehingga nilai buku tak jatuh
 * di bawah residu. Mengembalikan "0.00" bila aset sudah habis disusutkan.
 */
export function computePeriodDepreciation(p: DepreciationParams): string {
  const depreciableBase = toDb(sub(p.cost, p.residualValue));
  const remaining = toDb(sub(depreciableBase, p.accumulated));
  if (cmp(remaining, "0") <= 0) return "0.00";

  let raw = "0.00";
  if (p.method === "straight_line") {
    if (p.usefulLifeMonths <= 0) return "0.00";
    raw = toDb(div(depreciableBase, String(p.usefulLifeMonths)));
  } else if (p.method === "declining_balance") {
    if (!p.decliningRatePercent) return "0.00";
    const bookValue = toDb(sub(p.cost, p.accumulated));
    if (cmp(bookValue, "0") <= 0) return "0.00";
    raw = toDb(mul(bookValue, div(p.decliningRatePercent, "100")));
  } else {
    // units_of_production
    if (!p.totalUnits || p.totalUnits <= 0 || p.periodUnits == null || p.periodUnits <= 0) {
      return "0.00";
    }
    raw = toDb(mul(depreciableBase, div(String(p.periodUnits), String(p.totalUnits))));
  }

  if (cmp(raw, "0") <= 0) return "0.00";
  // Cap: tidak melewati sisa yang dapat disusutkan (raw & remaining sudah 2dp).
  return minAmount(raw, remaining);
}

/** Bentuk aset + kategori -> parameter mesin (override aset menang). */
export function resolveDepreciationParams(input: {
  asset: {
    cost: string;
    accumulatedDepreciation: string;
    residualValue: string | null;
    usefulLifeMonths: number | null;
    depreciationMethod: DepreciationMethod | null;
    decliningRatePercent: string | null;
    totalUnits: number | null;
  };
  category: {
    depreciationMethod: DepreciationMethod;
    usefulLifeMonths: number;
    residualPercent: string;
    decliningRatePercent: string | null;
    totalUnits: number | null;
  };
  periodUnits: number | null;
}): DepreciationParams {
  const { asset, category } = input;
  const method = asset.depreciationMethod ?? category.depreciationMethod;
  const residualValue =
    asset.residualValue != null
      ? toDb(asset.residualValue)
      : toDb(mul(asset.cost, div(category.residualPercent, "100")));
  return {
    method,
    cost: toDb(asset.cost),
    residualValue,
    accumulated: toDb(asset.accumulatedDepreciation),
    usefulLifeMonths: asset.usefulLifeMonths ?? category.usefulLifeMonths,
    decliningRatePercent: asset.decliningRatePercent ?? category.decliningRatePercent,
    totalUnits: asset.totalUnits ?? category.totalUnits,
    periodUnits: input.periodUnits,
  };
}
