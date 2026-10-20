import type { JournalLineInput } from "@/modules/accounting/schemas";
import type { PayrollAccounts } from "@/modules/payroll/payroll-account-config";
import { add, cmp, isBalanced, sub, sum, toDb } from "@/lib/money";

/**
 * Membangun baris jurnal akrual payroll dari agregat run (sudah dikonversi ke
 * mata uang dasar). Selalu seimbang karena konstruksi:
 *   Dr beban gaji             = gross
 *   Dr beban iuran (BPJS)      = porsi pemberi kerja
 *   Cr utang PPh21            = pajak dipotong
 *   Cr utang iuran (BPJS)      = porsi pekerja + pemberi kerja
 *   Cr utang potongan lain    = penyesuaian/potongan non-statutory (bila ada)
 *   Cr utang gaji (net pay)    = net
 * Saldo dijaga eksplisit (fail-closed) agar regressi kalkulasi terdeteksi dini.
 */

export type PayrollJournalAggregate = {
  grossEarnings: string;
  totalDeductions: string;
  netPay: string;
  tax: string;
  bpjsEmployee: string;
  bpjsEmployer: string;
  otherDeduction: string;
};

export function buildPayrollJournalLines(
  accounts: PayrollAccounts,
  otherDeductionAccountId: string | null,
  agg: PayrollJournalAggregate,
): JournalLineInput[] {
  const lines: JournalLineInput[] = [];
  const push = (
    accountId: string,
    side: "debit" | "credit",
    amount: string,
    memo: string,
  ) => {
    if (cmp(amount, "0") <= 0) return;
    lines.push({ accountId, side, amount, memo });
  };

  // Debit beban.
  push(accounts.salaryExpenseAccountId, "debit", agg.grossEarnings, "Beban gaji & tunjangan");
  push(accounts.bpjsExpenseAccountId, "debit", agg.bpjsEmployer, "Beban iuran BPJS pemberi kerja");

  // Kredit liabilitas.
  push(accounts.pph21PayableAccountId, "credit", agg.tax, "Utang PPh 21 dipotong");
  push(
    accounts.bpjsPayableAccountId,
    "credit",
    toDb(add(agg.bpjsEmployee, agg.bpjsEmployer)),
    "Utang iuran BPJS (pekerja + pemberi kerja)",
  );
  if (cmp(agg.otherDeduction, "0") > 0) {
    if (!otherDeductionAccountId) {
      throw new Error("Ada potongan non-statutory namun akun utang potongan lain belum diatur.");
    }
    push(otherDeductionAccountId, "credit", agg.otherDeduction, "Utang potongan lain");
  }
  push(accounts.payrollPayableAccountId, "credit", agg.netPay, "Utang gaji (take-home pay)");

  // Penjaga keseimbangan (fail-closed).
  const debits = lines.filter((l) => l.side === "debit").map((l) => l.amount);
  const credits = lines.filter((l) => l.side === "credit").map((l) => l.amount);
  if (!isBalanced(debits, credits)) {
    const diff = toDb(sub(sum(debits), sum(credits)));
    throw new Error(`Jurnal payroll tidak seimbang (selisih ${diff}).`);
  }
  return lines;
}
