import { and, asc, eq, inArray, sql } from "drizzle-orm";

import {
  assetCategories,
  assetDepreciationRuns,
  fixedAssets,
  journalEntries,
  journalEntryLines,
} from "@/db/schema";
import type { AssetRegisterQuery, AssetReconciliationQuery } from "@/modules/assets/report-schemas";
import { assertCan, type Reader, type Tx } from "@/modules/assets/_refs";
import { resolveAssetAccountIds } from "@/modules/assets/asset-account-config";
import { cmp, dec, sub, toDb, type Money } from "@/lib/money";
import { db } from "@/server/db";
import type { AuthContext } from "@/server/authz";

/**
 * Laporan aset (Tahap 8B), read-only. Register + rekonsiliasi subledger↔GL.
 * Subledger diambil dari register (harga perolehan & akumulasi pada aset yang
 * BELUM dilepas); GL dari baris jurnal posted+reversed pada akun aset di
 * companySettings. Rekonsiliasi mengasumsikan bagan akun terpusat (override akun
 * per kategori tidak dipisahkan di sini — itu jalur lanjutan).
 */

const DP = 2;
const LEDGER_STATUSES = ["posted", "reversed"] as const;

/* ---------------------------- Register ---------------------------- */

export async function assetRegister(actor: AuthContext, query: AssetRegisterQuery, externalTx?: Tx) {
  assertCan(actor, "assets.reports.read");
  const reader: Reader = externalTx ?? db;

  const rows = await reader
    .select({
      id: fixedAssets.id,
      code: fixedAssets.code,
      name: fixedAssets.name,
      categoryCode: assetCategories.code,
      categoryName: assetCategories.name,
      branchId: fixedAssets.branchId,
      departmentId: fixedAssets.departmentId,
      costCenterId: fixedAssets.costCenterId,
      inServiceDate: fixedAssets.inServiceDate,
      depreciationMethod: fixedAssets.depreciationMethod,
      status: fixedAssets.status,
      cost: fixedAssets.cost,
      accumulatedDepreciation: fixedAssets.accumulatedDepreciation,
      residualValue: fixedAssets.residualValue,
    })
    .from(fixedAssets)
    .innerJoin(assetCategories, eq(assetCategories.id, fixedAssets.categoryId))
    .where(
      and(
        query.categoryId ? eq(fixedAssets.categoryId, query.categoryId) : undefined,
        query.branchId ? eq(fixedAssets.branchId, query.branchId) : undefined,
        query.status ? eq(fixedAssets.status, query.status) : undefined,
      ),
    )
    .orderBy(asc(fixedAssets.code));

  let totalCost = dec(0);
  let totalAccum = dec(0);
  const detailed = rows.map((r) => {
    const book = toDb(sub(r.cost, r.accumulatedDepreciation), DP);
    totalCost = totalCost.plus(dec(r.cost));
    totalAccum = totalAccum.plus(dec(r.accumulatedDepreciation));
    return { ...r, netBookValue: book };
  });

  return {
    count: detailed.length,
    totalCost: toDb(totalCost, DP),
    totalAccumulated: toDb(totalAccum, DP),
    totalNetBook: toDb(sub(toDb(totalCost, DP), toDb(totalAccum, DP)), DP),
    rows: detailed,
  };
}

/* ------------------- Rekonsiliasi subledger ↔ GL ------------------ */

export async function assetGlReconciliation(actor: AuthContext, _query: AssetReconciliationQuery, externalTx?: Tx) {
  assertCan(actor, "assets.reports.read");
  const reader: Reader = externalTx ?? db;
  const accounts = await resolveAssetAccountIds(reader);

  // ---- Subledger (register aset non-disposed) ----
  const [subAgg] = await reader
    .select({
      cost: sql<string>`coalesce(sum(${fixedAssets.cost}), 0)::numeric(18,2)`,
      accum: sql<string>`coalesce(sum(${fixedAssets.accumulatedDepreciation}), 0)::numeric(18,2)`,
    })
    .from(fixedAssets)
    .where(sql`${fixedAssets.status} <> 'disposed'`);

  const subCost = dec(subAgg?.cost ?? "0");
  const subAccum = dec(subAgg?.accum ?? "0");

  // Beban penyusutan dari run berstatus posted (run reversed dikecualikan).
  const [expAgg] = await reader
    .select({ total: sql<string>`coalesce(sum(${assetDepreciationRuns.totalDepreciation}), 0)::numeric(18,2)` })
    .from(assetDepreciationRuns)
    .where(eq(assetDepreciationRuns.status, "posted"));
  const subExpense = dec(expAgg?.total ?? "0");

  // ---- GL (jurnal posted+reversed) ----
  const costGl = await glNet(reader, accounts.assetCostAccountId, "debit");
  const accumGl = await glNet(reader, accounts.accumulatedDepreciationAccountId, "credit");
  const expenseGl = await glNet(reader, accounts.depreciationExpenseAccountId, "debit");

  const lines = [
    line("Harga perolehan aset (Aset)", subCost, costGl),
    line("Akumulasi penyusutan (Kontra-aset)", subAccum, accumGl),
    line("Beban penyusutan periodik (Beban)", subExpense, expenseGl),
  ];

  return {
    accounts,
    inputs: {
      subledgerCost: toDb(subCost, DP),
      subledgerAccumulated: toDb(subAccum, DP),
      subledgerNetBook: toDb(sub(subCost, subAccum), DP),
      postedDepreciationExpense: toDb(subExpense, DP),
    },
    lines,
    balanced: lines.every((l) => l.matched),
  };
}

/* ----------------------------- Helper GL ---------------------------- */

async function glNet(reader: Reader, accountId: string, normal: "debit" | "credit"): Promise<Money> {
  const [row] = await reader
    .select({
      debit: sql<string>`coalesce(sum(${journalEntryLines.debit}), 0)::numeric(18,2)`,
      credit: sql<string>`coalesce(sum(${journalEntryLines.credit}), 0)::numeric(18,2)`,
    })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.entryId))
    .where(
      and(
        inArray(journalEntries.status, [...LEDGER_STATUSES]),
        eq(journalEntryLines.accountId, accountId),
      ),
    );
  const debit = dec(row?.debit ?? "0");
  const credit = dec(row?.credit ?? "0");
  return normal === "debit" ? debit.minus(credit) : credit.minus(debit);
}

function line(label: string, subledger: Money, gl: Money) {
  const difference = subledger.minus(gl);
  return {
    label,
    subledger: toDb(subledger, DP),
    gl: toDb(gl, DP),
    difference: toDb(difference, DP),
    matched: cmp(difference, "0") === 0,
  };
}
