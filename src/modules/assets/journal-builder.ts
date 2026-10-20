import type { JournalLineInput } from "@/modules/accounting/schemas";
import { cmp, isBalanced, sub, sum, toDb } from "@/lib/money";

/* ------------------------------------------------------------------ */
/* Konstruksi baris jurnal aset (fail-closed: keseimbangan dijaga).    */
/* Semua nominal string desimal. Baris bernilai 0 dilewati.            */
/* ------------------------------------------------------------------ */

function finish(lines: JournalLineInput[], label: string): JournalLineInput[] {
  const debits = lines.filter((l) => l.side === "debit").map((l) => l.amount);
  const credits = lines.filter((l) => l.side === "credit").map((l) => l.amount);
  if (!isBalanced(debits, credits)) {
    const diff = toDb(sub(sum(debits), sum(credits)));
    throw new Error(`Jurnal ${label} tidak seimbang (selisih ${diff}).`);
  }
  return lines;
}

const push = (
  lines: JournalLineInput[],
  accountId: string,
  side: "debit" | "credit",
  amount: string,
  memo: string,
) => {
  if (cmp(amount, "0") <= 0) return;
  lines.push({ accountId, side, amount: toDb(amount), memo });
};

/** Akuisisi standalone: Dr Aset (harga perolehan) / Cr sumber dana. */
export function buildAcquisitionJournalLines(
  accounts: { assetCostAccountId: string; fundingAccountId: string },
  amount: string,
): JournalLineInput[] {
  const lines: JournalLineInput[] = [];
  push(lines, accounts.assetCostAccountId, "debit", amount, "Perolehan aset tetap");
  push(lines, accounts.fundingAccountId, "credit", amount, "Sumber dana akuisisi");
  return finish(lines, "akuisisi aset");
}

/** Run penyusutan agregat: Dr Beban penyusutan / Cr Akumulasi penyusutan. */
export function buildDepreciationJournalLines(
  accounts: { depreciationExpenseAccountId: string; accumulatedDepreciationAccountId: string },
  total: string,
): JournalLineInput[] {
  const lines: JournalLineInput[] = [];
  push(lines, accounts.depreciationExpenseAccountId, "debit", total, "Beban penyusutan");
  push(lines, accounts.accumulatedDepreciationAccountId, "credit", total, "Akumulasi penyusutan");
  return finish(lines, "penyusutan");
}

export type DisposalFigures = {
  costRemoved: string;
  accumulatedRemoved: string;
  proceeds: string;
};

/**
 * Pelepasan: Dr Akumulasi + Dr Kas/Hasil (proceeds) / Cr Aset (cost) + selisih ke
 * Cr Laba pelepasan (bila untung) atau Dr Rugi pelepasan (bila rugi). Seimbang by design.
 */
export function buildDisposalJournalLines(
  accounts: {
    assetCostAccountId: string;
    accumulatedDepreciationAccountId: string;
    proceedsAccountId: string | null;
    disposalLossAccountId: string;
    disposalGainAccountId: string;
  },
  f: DisposalFigures,
): JournalLineInput[] {
  const lines: JournalLineInput[] = [];
  push(lines, accounts.accumulatedDepreciationAccountId, "debit", f.accumulatedRemoved, "Hapus akumulasi penyusutan");
  if (accounts.proceedsAccountId) {
    push(lines, accounts.proceedsAccountId, "debit", f.proceeds, "Hasil penjualan aset");
  }
  push(lines, accounts.assetCostAccountId, "credit", f.costRemoved, "Hapus harga perolehan aset");

  const netBook = toDb(sub(f.costRemoved, f.accumulatedRemoved));
  const gainLoss = toDb(sub(f.proceeds, netBook));
  if (cmp(gainLoss, "0") > 0) {
    push(lines, accounts.disposalGainAccountId, "credit", gainLoss, "Laba pelepasan aset");
  } else if (cmp(gainLoss, "0") < 0) {
    push(lines, accounts.disposalLossAccountId, "debit", toDb(sub("0", gainLoss)), "Rugi pelepasan aset");
  }
  return finish(lines, "pelepasan aset");
}

export type RevaluationFigures = {
  oldCost: string;
  oldAccumulated: string;
  newCost: string;
  newAccumulated: string;
};

/**
 * Revaluasi minimal (lewat P&L): sesuaikan biaya & akumulasi ke nilai baru; selisih
 * nilai buku ke Cr Laba (kenaikan) atau Dr Rugi (penurunan) akun pelepasan.
 */
export function buildRevaluationJournalLines(
  accounts: {
    assetCostAccountId: string;
    accumulatedDepreciationAccountId: string;
    disposalLossAccountId: string;
    disposalGainAccountId: string;
  },
  f: RevaluationFigures,
): JournalLineInput[] {
  const lines: JournalLineInput[] = [];
  const deltaCost = toDb(sub(f.newCost, f.oldCost));
  const deltaAccum = toDb(sub(f.newAccumulated, f.oldAccumulated));

  if (cmp(deltaCost, "0") >= 0) {
    push(lines, accounts.assetCostAccountId, "debit", deltaCost, "Sesuaikan harga perolehan (naik)");
  } else {
    push(lines, accounts.assetCostAccountId, "credit", toDb(sub("0", deltaCost)), "Sesuaikan harga perolehan (turun)");
  }
  if (cmp(deltaAccum, "0") >= 0) {
    push(lines, accounts.accumulatedDepreciationAccountId, "credit", deltaAccum, "Sesuaikan akumulasi (naik)");
  } else {
    push(lines, accounts.accumulatedDepreciationAccountId, "debit", toDb(sub("0", deltaAccum)), "Sesuaikan akumulasi (turun)");
  }

  const nbvChange = toDb(sub(deltaCost, deltaAccum));
  if (cmp(nbvChange, "0") > 0) {
    push(lines, accounts.disposalGainAccountId, "credit", nbvChange, "Keuntungan revaluasi");
  } else if (cmp(nbvChange, "0") < 0) {
    push(lines, accounts.disposalLossAccountId, "debit", toDb(sub("0", nbvChange)), "Kerugian revaluasi");
  }
  return finish(lines, "revaluasi aset");
}

/** Untung (+) / rugi (-) pelepasan sebagai string bertanda, utk disimpan di kolom. */
export function disposalGainLoss(f: DisposalFigures): { gain: string; loss: string } {
  const netBook = toDb(sub(f.costRemoved, f.accumulatedRemoved));
  const gl = toDb(sub(f.proceeds, netBook));
  return cmp(gl, "0") >= 0 ? { gain: gl, loss: "0.00" } : { gain: "0.00", loss: toDb(sub("0", gl)) };
}
