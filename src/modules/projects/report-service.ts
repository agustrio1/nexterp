import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import {
  chartAccounts,
  costCenters,
  journalEntries,
  journalEntryLines,
  projectBudgets,
  projects,
} from "@/db/schema";
import type { ProfitabilityQuery } from "@/modules/projects/report-schemas";
import { assertCan, requireProject, type Reader, type Tx } from "@/modules/projects/_refs";
import { dec, div, mul, sub, toDb, type Money } from "@/lib/money";
import { db } from "@/server/db";
import type { AuthContext } from "@/server/authz";

/**
 * Laporan profitabilitas proyek (Tahap 8C). Biaya & pendapatan proyek TIDAK
 * disimpan di tabel terpisah (keputusan "proyek = cost center"): selalu
 * diturunkan dari baris jurnal posted+reversed yang ber-tag costCenterId
 * proyek — sama sumbernya dengan buku besar (pola 4E/4I). Variance anggaran
 * membandingkan project_budgets vs realisasi GL per akun/periode.
 */

const DP = 2;
const LEDGER_STATUSES = ["posted", "reversed"] as const;

type AccountType = "revenue" | "expense";

/** Net normal-side (revenue: kredit-debit; expense: debit-kredit) per tag cc. */
async function ccMovement(
  reader: Reader,
  args: {
    costCenterId: string;
    accountType: AccountType;
    accountId?: string | null;
    from?: string | null;
    to?: string | null;
  },
): Promise<Money> {
  const conditions = [
    inArray(journalEntries.status, [...LEDGER_STATUSES]),
    eq(journalEntryLines.costCenterId, args.costCenterId),
    eq(chartAccounts.type, args.accountType),
    args.accountId ? eq(journalEntryLines.accountId, args.accountId) : undefined,
    args.from ? gte(journalEntries.entryDate, args.from) : undefined,
    args.to ? lte(journalEntries.entryDate, args.to) : undefined,
  ];
  const debitSigned = args.accountType === "expense";
  const [row] = await reader
    .select({
      net: sql<string>`coalesce(sum(case when ${debitSigned} then ${journalEntryLines.debit} - ${journalEntryLines.credit} else ${journalEntryLines.credit} - ${journalEntryLines.debit} end), 0)::numeric(18,2)`,
    })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.entryId))
    .innerJoin(chartAccounts, eq(chartAccounts.id, journalEntryLines.accountId))
    .where(and(...conditions));
  return dec(row?.net ?? "0");
}

/** Rentang tanggal satu bulan (YYYY-MM): dari awal sampai akhir bulan. */
function monthRange(periodKey: string): { from: string; to: string } {
  const [year, month] = [Number(periodKey.slice(0, 4)), Number(periodKey.slice(5, 7))];
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${periodKey}-01`, to: `${periodKey}-${String(lastDay).padStart(2, "0")}` };
}

export async function projectProfitability(
  actor: AuthContext,
  query: ProfitabilityQuery,
  externalTx?: Tx,
) {
  assertCan(actor, "projects.reports.read");
  const reader: Reader = externalTx ?? db;

  if (query.projectId) await requireProject(reader, query.projectId);

  const projectRows = await reader
    .select({
      id: projects.id,
      code: projects.code,
      projectNumber: projects.projectNumber,
      name: projects.name,
      status: projects.status,
      progressPercent: projects.progressPercent,
      totalBudget: projects.totalBudget,
      costCenterId: projects.costCenterId,
      costCenterCode: costCenters.code,
    })
    .from(projects)
    .innerJoin(costCenters, eq(costCenters.id, projects.costCenterId))
    .where(query.projectId ? eq(projects.id, query.projectId) : undefined)
    .orderBy(asc(projects.code));

  const items = [];
  let grandRevenue = dec(0);
  let grandCost = dec(0);
  for (const p of projectRows) {
    const revenue = await ccMovement(reader, { costCenterId: p.costCenterId, accountType: "revenue", from: query.from, to: query.to });
    const cost = await ccMovement(reader, { costCenterId: p.costCenterId, accountType: "expense", from: query.from, to: query.to });
    const margin = sub(toDb(revenue, DP), toDb(cost, DP));
    grandRevenue = grandRevenue.plus(revenue);
    grandCost = grandCost.plus(cost);

    const budgetLines = await reader
      .select({
        id: projectBudgets.id,
        accountId: projectBudgets.accountId,
        periodKey: projectBudgets.periodKey,
        amount: projectBudgets.amount,
        accountCode: chartAccounts.code,
        accountName: chartAccounts.name,
        accountType: chartAccounts.type,
      })
      .from(projectBudgets)
      .leftJoin(chartAccounts, eq(chartAccounts.id, projectBudgets.accountId))
      .where(eq(projectBudgets.projectId, p.id))
      .orderBy(asc(chartAccounts.code), asc(projectBudgets.periodKey));

    const variances = [];
    for (const b of budgetLines) {
      const range = b.periodKey ? monthRange(b.periodKey) : { from: query.from, to: query.to };
      let actual: Money;
      if (b.accountId) {
        actual = await ccMovement(reader, {
          costCenterId: p.costCenterId,
          accountType: b.accountType === "revenue" ? "revenue" : "expense",
          accountId: b.accountId,
          from: range.from,
          to: range.to,
        });
      } else {
        // Baris agregat (tanpa akun): realisasi sisi beban — view biaya proyek.
        actual = await ccMovement(reader, { costCenterId: p.costCenterId, accountType: "expense", from: range.from, to: range.to });
      }
      const budget = dec(b.amount);
      variances.push({
        id: b.id,
        accountId: b.accountId,
        accountCode: b.accountCode,
        accountName: b.accountName,
        periodKey: b.periodKey,
        budget: toDb(budget, DP),
        actual: toDb(actual, DP),
        variance: toDb(sub(actual, budget), DP),
        realizationPct: budget.isZero() ? null : toDb(mul(actual, "100").div(budget), DP),
      });
    }

    items.push({
      id: p.id,
      code: p.code,
      projectNumber: p.projectNumber,
      name: p.name,
      status: p.status,
      progressPercent: p.progressPercent,
      costCenterCode: p.costCenterCode,
      revenue: toDb(revenue, DP),
      cost: toDb(cost, DP),
      margin: toDb(margin, DP),
      marginPct: revenue.isZero() ? null : toDb(div(mul(margin, "100"), revenue), DP),
      totalBudget: p.totalBudget,
      budgetVariances: variances,
    });
  }

  return {
    count: items.length,
    totals: {
      revenue: toDb(grandRevenue, DP),
      cost: toDb(grandCost, DP),
      margin: toDb(sub(toDb(grandRevenue, DP), toDb(grandCost, DP)), DP),
    },
    items,
  };
}
