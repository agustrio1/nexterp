import { eq } from "drizzle-orm";

import { chartAccounts, companySettings } from "@/db/schema";
import { db } from "@/server/db";
import { businessRule } from "@/server/errors";

/**
 * Konfigurasi akun GL untuk buku besar AP/GR-IR perpetual (Tahap 5G).
 * Tiga akun dikunci di `companySettings` (jsonb) sebagai id chart_accounts, sama
 * seperti `retained_earnings_account_id` (4F). Service memvalidasi tipe + postable +
 * aktif saat dipakai memposting jurnal, sehingga kesalahan konfigurasi gagal-tertutup.
 *   - inventory_account_id : aset (1300) — sisi Debit saat GR
 *   - grir_account_id      : liabilitas (2115) — Cr saat GR, Dr saat invoice
 *   - ap_account_id        : liabilitas (2110) — Cr saat invoice, Dr saat pembayaran
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Tx | typeof db;

const SETTING_INVENTORY = "inventory_account_id";
const SETTING_GRIR = "grir_account_id";
const SETTING_AP = "ap_account_id";

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

/** Selesaikan + validasi ketiga akun GL AP/GR-IR. Dipakai saat memposting GR/invoice/pembayaran. */
export async function resolveApAccountIds(reader: Reader): Promise<{
  inventoryAccountId: string;
  grirAccountId: string;
  apAccountId: string;
}> {
  const inventoryAccountId = await requireConfiguredAccount(
    reader,
    SETTING_INVENTORY,
    "persediaan",
    "asset",
  );
  const grirAccountId = await requireConfiguredAccount(reader, SETTING_GRIR, "GR/IR", "liability");
  const apAccountId = await requireConfiguredAccount(reader, SETTING_AP, "utang usaha", "liability");
  return { inventoryAccountId, grirAccountId, apAccountId };
}
