import { eq } from "drizzle-orm";

import { chartAccounts, companySettings } from "@/db/schema";
import { db } from "@/server/db";
import { businessRule } from "@/server/errors";

/**
 * Konfigurasi akun GL untuk buku besar AR/COGS perpetual (Tahap 6).
 * Empat akun dikunci di `companySettings` (jsonb) sebagai id chart_accounts.
 * Service memvalidasi tipe + postable + aktif saat posting jurnal (fail-closed).
 *   - ar_account_id            : aset (1200) — Dr saat invoice, Cr saat pembayaran
 *   - revenue_account_id       : pendapatan (4100) — Cr saat invoice
 *   - cogs_account_id          : beban (5100) — Dr saat delivery
 *   - tax_payable_account_id   : liabilitas (2130) — Cr PPN output saat invoice
 * Also reuses inventory_account_id (1300) from AP config for COGS Cr side.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Tx | typeof db;

const SETTING_AR = "ar_account_id";
const SETTING_REVENUE = "revenue_account_id";
const SETTING_COGS = "cogs_account_id";
const SETTING_TAX_PAYABLE = "tax_payable_account_id";
const SETTING_INVENTORY = "inventory_account_id";

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

/** Selesaikan + validasi akun GL AR/COGS/Revenue/Tax. Dipakai saat posting delivery/invoice/payment. */
export async function resolveArAccountIds(reader: Reader): Promise<{
  arAccountId: string;
  revenueAccountId: string;
  cogsAccountId: string;
  taxPayableAccountId: string;
  inventoryAccountId: string;
}> {
  const arAccountId = await requireConfiguredAccount(reader, SETTING_AR, "piutang usaha", "asset");
  const revenueAccountId = await requireConfiguredAccount(reader, SETTING_REVENUE, "pendapatan penjualan", "revenue");
  const cogsAccountId = await requireConfiguredAccount(reader, SETTING_COGS, "harga pokok penjualan", "expense");
  const taxPayableAccountId = await requireConfiguredAccount(reader, SETTING_TAX_PAYABLE, "utang pajak", "liability");
  const inventoryAccountId = await requireConfiguredAccount(reader, SETTING_INVENTORY, "persediaan", "asset");
  return { arAccountId, revenueAccountId, cogsAccountId, taxPayableAccountId, inventoryAccountId };
}
