import { eq } from "drizzle-orm";

import { chartAccounts, companySettings } from "@/db/schema";
import { db } from "@/server/db";
import { businessRule } from "@/server/errors";

/**
 * Konfigurasi akun GL untuk jurnal aset tetap (Tahap 8A).
 * Akun dikunci di `companySettings` sebagai id chart_accounts; service memvalidasi
 * tipe + postable + aktif saat posting jurnal (fail-closed). Disiplin sama dengan
 * payroll-account-config (Tahap 7A) dan ar-account-config (Tahap 6A).
 *   - asset_cost_account_id                 : aset (1xxx) — Dr harga perolehan aset
 *   - accumulated_depreciation_account_id   : aset (kontra-aktiva) — Cr akumulasi penyusutan
 *   - depreciation_expense_account_id       : beban (5xxx) — Dr beban penyusutan periodik
 *   - asset_payable_account_id              : liabilitas (2xxx) — Cr akuisisi sumber "utang" (opsional)
 *   - disposal_loss_account_id              : beban (5xxx) — Dr rugi pelepasan
 *   - disposal_gain_account_id              : pendapatan (4xxx) — Cr laba pelepasan
 * Sumber dana bank/kas akuisisi memakai rekening bank (bank_accounts) per catatan,
 * bukan companySettings.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Tx | typeof db;

const SETTING_ASSET_COST = "asset_cost_account_id";
const SETTING_ACCUM_DEPRECIATION = "accumulated_depreciation_account_id";
const SETTING_DEPRECIATION_EXPENSE = "depreciation_expense_account_id";
const SETTING_ASSET_PAYABLE = "asset_payable_account_id";
const SETTING_DISPOSAL_LOSS = "disposal_loss_account_id";
const SETTING_DISPOSAL_GAIN = "disposal_gain_account_id";

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

export type AssetAccounts = Awaited<ReturnType<typeof resolveAssetAccountIds>>;

/** Akun inti untuk perolehan & penyusutan. Wajib ada saat posting jurnal aset. */
export async function resolveAssetAccountIds(reader: Reader): Promise<{
  assetCostAccountId: string;
  accumulatedDepreciationAccountId: string;
  depreciationExpenseAccountId: string;
}> {
  const assetCostAccountId = await requireConfiguredAccount(
    reader,
    SETTING_ASSET_COST,
    "harga perolehan aset",
    "asset",
  );
  const accumulatedDepreciationAccountId = await requireConfiguredAccount(
    reader,
    SETTING_ACCUM_DEPRECIATION,
    "akumulasi penyusutan",
    "asset",
  );
  const depreciationExpenseAccountId = await requireConfiguredAccount(
    reader,
    SETTING_DEPRECIATION_EXPENSE,
    "beban penyusutan",
    "expense",
  );
  return { assetCostAccountId, accumulatedDepreciationAccountId, depreciationExpenseAccountId };
}

/**
 * Validasi id akun eksplisit (mis. override per kategori): harus ada, aktif,
 * postable, dan bertipe sesuai. Dipakai saat override kategori dipakai alih-alih
 * akun default companySettings.
 */
export async function validateAccountId(
  reader: Reader,
  id: string,
  label: string,
  expectedType: AccountType,
): Promise<string> {
  const [account] = await reader
    .select({
      id: chartAccounts.id,
      code: chartAccounts.code,
      type: chartAccounts.type,
      isActive: chartAccounts.isActive,
      isPostable: chartAccounts.isPostable,
    })
    .from(chartAccounts)
    .where(eq(chartAccounts.id, id))
    .limit(1);
  if (!account) throw businessRule(`Akun ${label} (override) tidak ditemukan di bagan akun.`);
  if (!account.isActive) throw businessRule(`Akun ${label} ${account.code} tidak aktif.`);
  if (!account.isPostable) {
    throw businessRule(`Akun ${label} ${account.code} bukan akun postable (induk pohon).`);
  }
  if (account.type !== expectedType) {
    throw businessRule(`Akun ${label} ${account.code} harus bertipe ${expectedType}.`);
  }
  return account.id;
}

/**
 * Akun efektif untuk aset: override kategori menang, fallback ke companySettings.
 * Tiap nilai divalidasi (tipe/postable/aktif) agar fail-closed.
 */
export async function resolveEffectiveAssetAccounts(
  reader: Reader,
  category: {
    assetCostAccountId: string | null;
    accumulatedDepreciationAccountId: string | null;
    depreciationExpenseAccountId: string | null;
  },
): Promise<AssetAccounts> {
  const config = await resolveAssetAccountIds(reader);
  const assetCostAccountId =
    category.assetCostAccountId != null
      ? await validateAccountId(reader, category.assetCostAccountId, "harga perolehan aset", "asset")
      : config.assetCostAccountId;
  const accumulatedDepreciationAccountId =
    category.accumulatedDepreciationAccountId != null
      ? await validateAccountId(
          reader,
          category.accumulatedDepreciationAccountId,
          "akumulasi penyusutan",
          "asset",
        )
      : config.accumulatedDepreciationAccountId;
  const depreciationExpenseAccountId =
    category.depreciationExpenseAccountId != null
      ? await validateAccountId(
          reader,
          category.depreciationExpenseAccountId,
          "beban penyusutan",
          "expense",
        )
      : config.depreciationExpenseAccountId;
  return { assetCostAccountId, accumulatedDepreciationAccountId, depreciationExpenseAccountId };
}

/** Akun laba/rugi pelepasan. Wajib ada saat posting jurnal pelepasan. */
export async function resolveDisposalAccountIds(reader: Reader): Promise<{
  disposalLossAccountId: string;
  disposalGainAccountId: string;
}> {
  const disposalLossAccountId = await requireConfiguredAccount(
    reader,
    SETTING_DISPOSAL_LOSS,
    "rugi pelepasan aset",
    "expense",
  );
  const disposalGainAccountId = await requireConfiguredAccount(
    reader,
    SETTING_DISPOSAL_GAIN,
    "laba pelepasan aset",
    "revenue",
  );
  return { disposalLossAccountId, disposalGainAccountId };
}

/**
 * Akun liabilitas untuk akuisisi ber-sumber dana "utang". OPSIONAL: hanya wajib bila
 * akuisisi memakai sumber utang (selainnya pakai rekening bank/kas per catatan).
 * Mengembalikan null bila belum diatur DAN tidak dibutuhkan.
 */
export async function resolveAssetPayableAccountId(
  reader: Reader,
  required: boolean,
): Promise<string | null> {
  const raw = await readSetting(reader, SETTING_ASSET_PAYABLE);
  if (typeof raw !== "string" || raw === "") {
    if (required) {
      throw businessRule(
        `Akun utang aset belum diatur (${SETTING_ASSET_PAYABLE}). Akuisisi bersumber utang butuh akun ini.`,
      );
    }
    return null;
  }
  return requireConfiguredAccount(reader, SETTING_ASSET_PAYABLE, "utang aset", "liability");
}
