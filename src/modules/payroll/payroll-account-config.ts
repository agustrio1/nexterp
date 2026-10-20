import { eq } from "drizzle-orm";

import { chartAccounts, companySettings } from "@/db/schema";
import { db } from "@/server/db";
import { businessRule } from "@/server/errors";

/**
 * Konfigurasi akun GL untuk jurnal payroll (Tahap 7A).
 * Lima akun dikunci di `companySettings` (jsonb) sebagai id chart_accounts.
 * Service memvalidasi tipe + postable + aktif saat posting jurnal (fail-closed).
 *   - salary_expense_account_id   : beban (5xxx) — Dr gaji/lembur/tunjangan
 *   - payroll_payable_account_id  : liabilitas (2xxx) — Cr net pay (utang ke karyawan)
 *   - pph21_payable_account_id    : liabilitas (2xxx) — Cr PPh 21 dipotong
 *   - bpjs_payable_account_id     : liabilitas (2xxx) — Cr iuran BPJS (pekerja + pemberi kerja)
 *   - bpjs_expense_account_id     : beban (5xxx) — Dr porsi iuran ditanggung perusahaan
 * Disiplin validasi sama dengan ar-account-config (Tahap 6).
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Tx | typeof db;

const SETTING_SALARY_EXPENSE = "salary_expense_account_id";
const SETTING_PAYROLL_PAYABLE = "payroll_payable_account_id";
const SETTING_PPH21_PAYABLE = "pph21_payable_account_id";
const SETTING_BPJS_PAYABLE = "bpjs_payable_account_id";
const SETTING_BPJS_EXPENSE = "bpjs_expense_account_id";
const SETTING_OTHER_DEDUCTION = "other_deduction_payable_account_id";

type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

async function readSetting(reader: Reader, key: string): Promise<unknown> {
  const [row] = await reader
    .select({ value: companySettings.value })
    .from(companySettings)
    .where(eq(companySettings.key, key))
    .limit(1);
  return row?.value;
}

async function requireConfiguredAccount(
  reader: Reader,
  key: string,
  label: string,
  expectedType: AccountType,
): Promise<string> {
  const raw = await readSetting(reader, key);
  if (typeof raw !== "string" || raw === "") {
    throw businessRule(`Akun ${label} belum diatur (${key}). Isi pengaturan perusahaan lebih dulu.`);
  }

  const [account] = await reader
    .select({
      id: chartAccounts.id,
      code: chartAccounts.code,
      type: chartAccounts.type,
      isActive: chartAccounts.isActive,
      isPostable: chartAccounts.isPostable,
    })
    .from(chartAccounts)
    .where(eq(chartAccounts.id, raw))
    .limit(1);
  if (!account) {
    throw businessRule(`Akun ${label} (${key}) tidak ditemukan di bagan akun.`);
  }
  if (!account.isActive) throw businessRule(`Akun ${label} ${account.code} tidak aktif.`);
  if (!account.isPostable) {
    throw businessRule(`Akun ${label} ${account.code} bukan akun postable (induk pohon).`);
  }
  if (account.type !== expectedType) {
    throw businessRule(`Akun ${label} ${account.code} harus bertipe ${expectedType}.`);
  }
  return account.id;
}

/** Selesaikan + validasi akun GL payroll. Dipakai saat posting jurnal run payroll. */
export type PayrollAccounts = Awaited<ReturnType<typeof resolvePayrollAccountIds>>;

export async function resolvePayrollAccountIds(reader: Reader): Promise<{
  salaryExpenseAccountId: string;
  payrollPayableAccountId: string;
  pph21PayableAccountId: string;
  bpjsPayableAccountId: string;
  bpjsExpenseAccountId: string;
}> {
  const salaryExpenseAccountId = await requireConfiguredAccount(
    reader,
    SETTING_SALARY_EXPENSE,
    "beban gaji",
    "expense",
  );
  const payrollPayableAccountId = await requireConfiguredAccount(
    reader,
    SETTING_PAYROLL_PAYABLE,
    "utang gaji",
    "liability",
  );
  const pph21PayableAccountId = await requireConfiguredAccount(
    reader,
    SETTING_PPH21_PAYABLE,
    "utang PPh 21",
    "liability",
  );
  const bpjsPayableAccountId = await requireConfiguredAccount(
    reader,
    SETTING_BPJS_PAYABLE,
    "utang iuran BPJS",
    "liability",
  );
  const bpjsExpenseAccountId = await requireConfiguredAccount(
    reader,
    SETTING_BPJS_EXPENSE,
    "beban iuran BPJS",
    "expense",
  );
  return {
    salaryExpenseAccountId,
    payrollPayableAccountId,
    pph21PayableAccountId,
    bpjsPayableAccountId,
    bpjsExpenseAccountId,
  };
}

/**
 * Akun liabilitas untuk potongan non-PPh21/non-BPJS (mis. cicilan koperasi, penyesuaian
 * deduction). OPSIONAL: hanya wajib bila kalkulasi menghasilkan otherDeduction > 0.
 * Mengembalikan null bila belum diatur DAN tidak ada pemakaiannya.
 */
export async function resolveOtherDeductionAccountId(
  reader: Reader,
  required: boolean,
): Promise<string | null> {
  const raw = await readSetting(reader, SETTING_OTHER_DEDUCTION);
  if (typeof raw !== "string" || raw === "") {
    if (required) {
      throw businessRule(
        `Akun utang potongan lain belum diatur (${SETTING_OTHER_DEDUCTION}). Ada penyesuaian/potongan non-statutory yang harus dijurnal.`,
      );
    }
    return null;
  }
  return requireConfiguredAccount(reader, SETTING_OTHER_DEDUCTION, "utang potongan lain", "liability");
}
