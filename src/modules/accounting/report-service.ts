import { and, asc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";

import {
  accountingPeriods,
  bankAccounts,
  budgetLines,
  budgets,
  cashTransactions,
  chartAccounts,
  costCenters,
  fiscalYears,
  journalEntries,
  journalEntryLines,
} from "@/db/schema";
import { dec, toDb, type Money } from "@/lib/money";
import type {
  BalanceSheetQuery,
  BudgetRealizationQuery,
  CashBookQuery,
  CashFlowQuery,
  CostCenterReportQuery,
  GeneralLedgerQuery,
  IncomeStatementQuery,
  TrialBalanceQuery,
} from "@/modules/accounting/report-schemas";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { forbidden, notFound } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Tx | typeof db;

/**
 * Laporan keuangan (Tahap 4E) dibangun murni dari baris jurnal milik entri
 * berstatus `posted` dan `reversed`. Entri pembalik (reversal) ikut dihitung
 * sehingga jurnal asal yang direversal saling meniadakan — neraca tetap seimbang.
 * Semua nominal memakai aritmetika desimal (`decimal.js`), output string 2 desimal.
 */

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

const LEDGER_STATUSES = ["posted", "reversed"] as const;

/** Akun bertipe asset & expense bersaldo normal debit; sisanya kredit. */
type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
function normalSide(type: AccountType): "debit" | "credit" {
  return type === "asset" || type === "expense" ? "debit" : "credit";
}

interface LedgerRow {
  entryId: string;
  docNo: string | null;
  entryDate: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  lineId: string;
  lineNo: number;
  debit: string;
  credit: string;
  memo: string | null;
  branchId: string | null;
  departmentId: string | null;
}

interface LedgerFilter {
  accountId?: string;
  accountTypes?: readonly AccountType[];
  /** entryDate >= dari (batas bawah inklusif). */
  dateFrom?: string;
  /** entryDate <= sampai (batas atas inklusif). */
  dateTo?: string;
  /** entryDate < sebelum (untuk saldo awal). */
  dateBefore?: string;
  branchId?: string;
  departmentId?: string;
}

/**
 * Mengambil baris buku besar (jurnal posted/reversed) yang cocok dengan filter.
 * Urutan stabil: tanggal, lalu id entri, lalu nomor baris — cukup deterministik
 * untuk saldo berjalan GL; agregasi per akun tidak bergantung urutan ini.
 */
async function fetchLedgerRows(reader: Reader, filter: LedgerFilter): Promise<LedgerRow[]> {
  const conditions = [
    inArray(journalEntries.status, [...LEDGER_STATUSES]),
    filter.accountId === undefined ? undefined : eq(journalEntryLines.accountId, filter.accountId),
    filter.accountTypes === undefined
      ? undefined
      : inArray(chartAccounts.type, [...filter.accountTypes]),
    filter.dateFrom === undefined ? undefined : gte(journalEntries.entryDate, filter.dateFrom),
    filter.dateTo === undefined ? undefined : lte(journalEntries.entryDate, filter.dateTo),
    filter.dateBefore === undefined ? undefined : lt(journalEntries.entryDate, filter.dateBefore),
    filter.branchId === undefined ? undefined : eq(journalEntryLines.branchId, filter.branchId),
    filter.departmentId === undefined
      ? undefined
      : eq(journalEntryLines.departmentId, filter.departmentId),
  ];

  return reader
    .select({
      entryId: journalEntries.id,
      docNo: journalEntries.docNo,
      entryDate: journalEntries.entryDate,
      accountId: chartAccounts.id,
      accountCode: chartAccounts.code,
      accountName: chartAccounts.name,
      accountType: chartAccounts.type,
      lineId: journalEntryLines.id,
      lineNo: journalEntryLines.lineNo,
      debit: journalEntryLines.debit,
      credit: journalEntryLines.credit,
      memo: journalEntryLines.memo,
      branchId: journalEntryLines.branchId,
      departmentId: journalEntryLines.departmentId,
    })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.entryId))
    .innerJoin(chartAccounts, eq(chartAccounts.id, journalEntryLines.accountId))
    .where(and(...conditions))
    .orderBy(asc(journalEntries.entryDate), asc(journalEntries.id), asc(journalEntryLines.lineNo));
}

/** Menyelesaikan rentang tanggal dari periodId ATAU from/to (sudah divalidasi skema). */
async function resolveRange(
  reader: Reader,
  query: { from?: string; to?: string; periodId?: string },
): Promise<{ from: string; to: string }> {
  if (query.periodId) {
    const [period] = await reader
      .select({ startDate: accountingPeriods.startDate, endDate: accountingPeriods.endDate })
      .from(accountingPeriods)
      .where(eq(accountingPeriods.id, query.periodId))
      .limit(1);
    if (!period) throw notFound("Periode akuntansi tidak ditemukan.");
    return { from: period.startDate, to: period.endDate };
  }
  return { from: query.from as string, to: query.to as string };
}

interface AccountAgg {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  debit: Money;
  credit: Money;
}

/** Menggabungkan baris per akun menjadi total debit & kredit. */
function aggregateByAccount(rows: readonly LedgerRow[]): Map<string, AccountAgg> {
  const map = new Map<string, AccountAgg>();
  for (const row of rows) {
    let agg = map.get(row.accountId);
    if (!agg) {
      agg = {
        accountId: row.accountId,
        code: row.accountCode,
        name: row.accountName,
        type: row.accountType,
        debit: dec(0),
        credit: dec(0),
      };
      map.set(row.accountId, agg);
    }
    agg.debit = agg.debit.plus(dec(row.debit));
    agg.credit = agg.credit.plus(dec(row.credit));
  }
  return map;
}

/** Saldo bersih akun pada sisi normalnya (bisa negatif bila sisi lawannya lebih besar). */
function netOnNormalSide(agg: AccountAgg): Money {
  return normalSide(agg.type) === "debit"
    ? agg.debit.minus(agg.credit)
    : agg.credit.minus(agg.debit);
}

function byCode(a: { code: string }, b: { code: string }): number {
  return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
}

/* ------------------------------------------------------------------ */
/* Buku besar per akun                                                 */
/* ------------------------------------------------------------------ */

export async function generalLedger(
  actor: AuthContext,
  query: GeneralLedgerQuery,
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.reports.read");

  const reader: Reader = externalTx ?? db;
  const range = await resolveRange(reader, query);

  const [account] = await reader
    .select({
      id: chartAccounts.id,
      code: chartAccounts.code,
      name: chartAccounts.name,
      type: chartAccounts.type,
      isActive: chartAccounts.isActive,
      isPostable: chartAccounts.isPostable,
    })
    .from(chartAccounts)
    .where(eq(chartAccounts.id, query.accountId))
    .limit(1);
  if (!account) throw notFound("Akun tidak ditemukan.");

  // Saldo awal = akumulasi mutasi sebelum `from` (filter cabang/departemen ikut).
  const openingRows = await fetchLedgerRows(reader, {
    accountId: query.accountId,
    dateBefore: range.from,
    branchId: query.branchId,
    departmentId: query.departmentId,
  });
  // Mutasi dalam rentang.
  const movementRows = await fetchLedgerRows(reader, {
    accountId: query.accountId,
    dateFrom: range.from,
    dateTo: range.to,
    branchId: query.branchId,
    departmentId: query.departmentId,
  });

  const side = normalSide(account.type);
  let running =
    side === "debit"
      ? sumSignedDebitCredit(openingRows)
      : sumSignedCreditDebit(openingRows);

  const openingBalance = running;
  const rows = movementRows.map((row) => {
    const delta =
      side === "debit"
        ? dec(row.debit).minus(dec(row.credit))
        : dec(row.credit).minus(dec(row.debit));
    running = running.plus(delta);
    return {
      entryDate: row.entryDate,
      entryId: row.entryId,
      docNo: row.docNo,
      lineId: row.lineId,
      lineNo: row.lineNo,
      memo: row.memo,
      debit: toDb(row.debit),
      credit: toDb(row.credit),
      balance: toDb(running),
    };
  });

  return {
    account,
    range,
    branchId: query.branchId ?? null,
    departmentId: query.departmentId ?? null,
    normalSide: side,
    openingBalance: toDb(openingBalance),
    rows,
    closingBalance: toDb(running),
  };
}

function sumSignedDebitCredit(rows: readonly LedgerRow[]): Money {
  return rows.reduce<Money>((acc, r) => acc.plus(dec(r.debit)).minus(dec(r.credit)), dec(0));
}
function sumSignedCreditDebit(rows: readonly LedgerRow[]): Money {
  return rows.reduce<Money>((acc, r) => acc.plus(dec(r.credit)).minus(dec(r.debit)), dec(0));
}

/* ------------------------------------------------------------------ */
/* Neraca saldo                                                        */
/* ------------------------------------------------------------------ */

export async function trialBalance(
  actor: AuthContext,
  query: TrialBalanceQuery,
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.reports.read");

  const reader: Reader = externalTx ?? db;
  const range = await resolveRange(reader, query);

  const rows = await fetchLedgerRows(reader, {
    dateFrom: range.from,
    dateTo: range.to,
    branchId: query.branchId,
  });

  const aggs = [...aggregateByAccount(rows).values()].sort(byCode);
  let totalDebit = dec(0);
  let totalCredit = dec(0);
  const items = aggs.map((agg) => {
    totalDebit = totalDebit.plus(agg.debit);
    totalCredit = totalCredit.plus(agg.credit);
    return {
      accountId: agg.accountId,
      code: agg.code,
      name: agg.name,
      type: agg.type,
      debit: toDb(agg.debit),
      credit: toDb(agg.credit),
    };
  });

  const debitStr = toDb(totalDebit);
  const creditStr = toDb(totalCredit);

  return {
    range,
    branchId: query.branchId ?? null,
    rows: items,
    totals: { debit: debitStr, credit: creditStr, balanced: debitStr === creditStr },
  };
}

/* ------------------------------------------------------------------ */
/* Laba rugi                                                           */
/* ------------------------------------------------------------------ */

export async function incomeStatement(
  actor: AuthContext,
  query: IncomeStatementQuery,
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.reports.read");

  const reader: Reader = externalTx ?? db;
  const range = await resolveRange(reader, query);

  const rows = await fetchLedgerRows(reader, {
    accountTypes: ["revenue", "expense"],
    dateFrom: range.from,
    dateTo: range.to,
    branchId: query.branchId,
  });

  const aggs = [...aggregateByAccount(rows).values()].sort(byCode);

  let totalRevenue = dec(0);
  let totalExpense = dec(0);
  const revenue: { accountId: string; code: string; name: string; amount: string }[] = [];
  const expense: { accountId: string; code: string; name: string; amount: string }[] = [];

  for (const agg of aggs) {
    // Pendapatan & beban bersaldo normal kredit & debit masing-masing.
    const amount =
      agg.type === "revenue" ? agg.credit.minus(agg.debit) : agg.debit.minus(agg.credit);
    const entry = { accountId: agg.accountId, code: agg.code, name: agg.name, amount: toDb(amount) };
    if (agg.type === "revenue") {
      revenue.push(entry);
      totalRevenue = totalRevenue.plus(amount);
    } else {
      expense.push(entry);
      totalExpense = totalExpense.plus(amount);
    }
  }

  return {
    range,
    branchId: query.branchId ?? null,
    revenue,
    expense,
    totalRevenue: toDb(totalRevenue),
    totalExpense: toDb(totalExpense),
    netIncome: toDb(totalRevenue.minus(totalExpense)),
  };
}

/* ------------------------------------------------------------------ */
/* Neraca                                                             */
/* ------------------------------------------------------------------ */

export async function balanceSheet(
  actor: AuthContext,
  query: BalanceSheetQuery,
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.reports.read");

  const reader: Reader = externalTx ?? db;

  let asOf: string;
  if (query.periodId) {
    const range = await resolveRange(reader, { periodId: query.periodId });
    asOf = range.to;
  } else {
    asOf = query.asOf as string;
  }

  // Kumulatif sejak awal hingga `asOf`.
  const rows = await fetchLedgerRows(reader, { dateTo: asOf, branchId: query.branchId });
  const aggs = [...aggregateByAccount(rows).values()].sort(byCode);

  const bucket = (type: AccountType) =>
    aggs
      .filter((a) => a.type === type)
      .map((a) => ({ accountId: a.accountId, code: a.code, name: a.name, amount: toDb(netOnNormalSide(a)) }));

  const assets = bucket("asset");
  const liabilities = bucket("liability");
  const equityAccounts = bucket("equity");

  const sumNet = (type: AccountType) =>
    aggs
      .filter((a) => a.type === type)
      .reduce<Money>((acc, a) => acc.plus(netOnNormalSide(a)), dec(0));

  const totalAssets = sumNet("asset");
  const totalLiabilities = sumNet("liability");
  const totalEquityAccounts = sumNet("equity");

  // Laba bersih kumulatif (pendapatan - beban) sampai asOf = laba ditahan sementara.
  const retainedEarnings = sumNet("revenue").minus(sumNet("expense"));
  const totalEquity = totalEquityAccounts.plus(retainedEarnings);
  const liabilitiesAndEquity = totalLiabilities.plus(totalEquity);

  const assetsStr = toDb(totalAssets);
  const leStr = toDb(liabilitiesAndEquity);

  return {
    asOf,
    branchId: query.branchId ?? null,
    assets,
    liabilities,
    equity: equityAccounts,
    retainedEarnings: toDb(retainedEarnings),
    totals: {
      assets: assetsStr,
      liabilities: toDb(totalLiabilities),
      equity: toDb(totalEquityAccounts),
      retainedEarnings: toDb(retainedEarnings),
      liabilitiesAndEquity: leStr,
      balanced: assetsStr === leStr,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Laporan per pusat biaya                                            */
/* ------------------------------------------------------------------ */

/**
 * Realisasi pendapatan vs beban per pusat biaya dalam rentang. Sumber sama dengan
 * laporan lain: baris jurnal `posted` dan `reversed`. Hanya baris yang memiliki
 * `cost_center_id` dan bertipe revenue/expense yang dihitung.
 */
export async function costCenterReport(
  actor: AuthContext,
  query: CostCenterReportQuery,
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.reports.read");

  const reader: Reader = externalTx ?? db;
  const range = await resolveRange(reader, query);

  const conditions = [
    inArray(journalEntries.status, [...LEDGER_STATUSES]),
    gte(journalEntries.entryDate, range.from),
    lte(journalEntries.entryDate, range.to),
    inArray(chartAccounts.type, ["revenue", "expense"]),
    query.branchId === undefined ? undefined : eq(journalEntryLines.branchId, query.branchId),
    query.costCenterId === undefined
      ? undefined
      : eq(journalEntryLines.costCenterId, query.costCenterId),
  ];

  const rows = await reader
    .select({
      costCenterId: costCenters.id,
      code: costCenters.code,
      name: costCenters.name,
      revenue: sql<string>`coalesce(sum(case when ${chartAccounts.type} = 'revenue' then ${journalEntryLines.credit} - ${journalEntryLines.debit} else 0 end), 0)`,
      expense: sql<string>`coalesce(sum(case when ${chartAccounts.type} = 'expense' then ${journalEntryLines.debit} - ${journalEntryLines.credit} else 0 end), 0)`,
    })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.entryId))
    .innerJoin(chartAccounts, eq(chartAccounts.id, journalEntryLines.accountId))
    .innerJoin(costCenters, eq(costCenters.id, journalEntryLines.costCenterId))
    .where(and(...conditions))
    .groupBy(costCenters.id, costCenters.code, costCenters.name)
    .orderBy(asc(costCenters.code));

  let totalRevenue = dec(0);
  let totalExpense = dec(0);
  const items = rows.map((row) => {
    const revenue = dec(row.revenue);
    const expense = dec(row.expense);
    totalRevenue = totalRevenue.plus(revenue);
    totalExpense = totalExpense.plus(expense);
    return {
      costCenterId: row.costCenterId,
      code: row.code,
      name: row.name,
      revenue: toDb(revenue),
      expense: toDb(expense),
      net: toDb(revenue.minus(expense)),
    };
  });

  return {
    range,
    branchId: query.branchId ?? null,
    rows: items,
    totals: {
      revenue: toDb(totalRevenue),
      expense: toDb(totalExpense),
      net: toDb(totalRevenue.minus(totalExpense)),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Buku kas/bank (Tahap 4H)                                            */
/* ------------------------------------------------------------------ */

/**
 * Mutasi dan saldo berjalan satu rekening kas/bank, diturunkan dari baris jurnal
 * (`posted` + `reversed`) pada akun GL rekening tersebut. Rekening kas/bank selalu
 * bertipe aset, sehingga sisi normal = debit (masuk menambah saldo).
 */
export async function cashBook(actor: AuthContext, query: CashBookQuery, externalTx?: Tx) {
  assertCan(actor, "accounting.reports.read");

  const reader: Reader = externalTx ?? db;
  const range = await resolveRange(reader, query);

  const [bank] = await reader
    .select({
      id: bankAccounts.id,
      code: bankAccounts.code,
      name: bankAccounts.name,
      kind: bankAccounts.kind,
      accountId: bankAccounts.accountId,
      isActive: bankAccounts.isActive,
    })
    .from(bankAccounts)
    .where(eq(bankAccounts.id, query.bankAccountId))
    .limit(1);
  if (!bank) throw notFound("Rekening kas/bank tidak ditemukan.");

  const openingRows = await fetchLedgerRows(reader, {
    accountId: bank.accountId,
    dateBefore: range.from,
    branchId: query.branchId,
  });
  const movementRows = await fetchLedgerRows(reader, {
    accountId: bank.accountId,
    dateFrom: range.from,
    dateTo: range.to,
    branchId: query.branchId,
  });

  let running = sumSignedDebitCredit(openingRows);
  let totalIn = dec(0);
  let totalOut = dec(0);

  const rows = movementRows.map((row) => {
    const delta = dec(row.debit).minus(dec(row.credit));
    running = running.plus(delta);
    totalIn = totalIn.plus(dec(row.debit));
    totalOut = totalOut.plus(dec(row.credit));
    return {
      entryDate: row.entryDate,
      entryId: row.entryId,
      docNo: row.docNo,
      memo: row.memo,
      debit: toDb(row.debit),
      credit: toDb(row.credit),
      balance: toDb(running),
    };
  });

  return {
    bankAccount: { id: bank.id, code: bank.code, name: bank.name, kind: bank.kind },
    range,
    branchId: query.branchId ?? null,
    openingBalance: toDb(sumSignedDebitCredit(openingRows)),
    rows,
    totals: { in: toDb(totalIn), out: toDb(totalOut) },
    closingBalance: toDb(running),
  };
}

/* ------------------------------------------------------------------ */
/* Realisasi vs anggaran (Tahap 4I)                                   */
/* ------------------------------------------------------------------ */

/**
 * Realisasi satu baris anggaran = mutasi bersih akun pada rentang periode,
 * dibatasi cabang anggaran dan (bila diisi) pusat biaya baris. Sisi bertanda
 * mengikuti tipe akun (aset/beban = debit-kredit; lainnya kredit-debit), sama
 * seperti laporan lain. Sumber: baris jurnal `posted` + `reversed`.
 */
async function accountMovement(reader: Reader, args: {
  accountId: string;
  from: string;
  to: string;
  type: AccountType;
  branchId: string | null;
  costCenterId: string | null;
}): Promise<Money> {
  const conditions = [
    inArray(journalEntries.status, [...LEDGER_STATUSES]),
    eq(journalEntryLines.accountId, args.accountId),
    gte(journalEntries.entryDate, args.from),
    lte(journalEntries.entryDate, args.to),
    args.branchId === null ? undefined : eq(journalEntryLines.branchId, args.branchId),
    args.costCenterId === null ? undefined : eq(journalEntryLines.costCenterId, args.costCenterId),
  ];

  const debitSigned = args.type === "asset" || args.type === "expense";
  const [row] = await reader
    .select({
      net: sql<string>`coalesce(sum(case when ${debitSigned} then ${journalEntryLines.debit} - ${journalEntryLines.credit} else ${journalEntryLines.credit} - ${journalEntryLines.debit} end), 0)`,
    })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.entryId))
    .where(and(...conditions));
  return dec(row?.net ?? "0");
}

/**
 * Realisasi vs anggaran. Tanpa `periodId`: seluruh tahun fiskal anggaran, baris
 * ditampil per periode. Dengan `periodId`: dipersempit ke satu periode.
 */
export async function budgetRealization(
  actor: AuthContext,
  query: BudgetRealizationQuery,
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.budgets.read");

  const reader: Reader = externalTx ?? db;

  const [header] = await reader
    .select({
      id: budgets.id,
      name: budgets.name,
      docNo: budgets.docNo,
      status: budgets.status,
      fiscalYearId: budgets.fiscalYearId,
      fiscalYearCode: fiscalYears.code,
      branchId: budgets.branchId,
      fyStart: fiscalYears.startDate,
      fyEnd: fiscalYears.endDate,
    })
    .from(budgets)
    .innerJoin(fiscalYears, eq(fiscalYears.id, budgets.fiscalYearId))
    .where(eq(budgets.id, query.budgetId))
    .limit(1);
  if (!header) throw notFound("Anggaran tidak ditemukan.");

  const lineConditions = [eq(budgetLines.budgetId, header.id)];
  if (query.periodId) lineConditions.push(eq(budgetLines.periodId, query.periodId));

  const lines = await reader
    .select({
      id: budgetLines.id,
      accountId: budgetLines.accountId,
      accountCode: chartAccounts.code,
      accountName: chartAccounts.name,
      accountType: chartAccounts.type,
      periodId: budgetLines.periodId,
      periodNo: accountingPeriods.periodNo,
      periodStart: accountingPeriods.startDate,
      periodEnd: accountingPeriods.endDate,
      costCenterId: budgetLines.costCenterId,
      costCenterCode: costCenters.code,
      amount: budgetLines.amount,
    })
    .from(budgetLines)
    .innerJoin(chartAccounts, eq(chartAccounts.id, budgetLines.accountId))
    .innerJoin(accountingPeriods, eq(accountingPeriods.id, budgetLines.periodId))
    .leftJoin(costCenters, eq(costCenters.id, budgetLines.costCenterId))
    .where(and(...lineConditions))
    .orderBy(asc(accountingPeriods.periodNo), asc(chartAccounts.code));

  let totalBudget = dec(0);
  let totalActual = dec(0);
  const items = [];
  for (const line of lines) {
    const actual = await accountMovement(reader, {
      accountId: line.accountId,
      from: line.periodStart,
      to: line.periodEnd,
      type: line.accountType,
      branchId: header.branchId,
      costCenterId: line.costCenterId,
    });
    const budget = dec(line.amount);
    const variance = actual.minus(budget);
    totalBudget = totalBudget.plus(budget);
    totalActual = totalActual.plus(actual);
    items.push({
      accountCode: line.accountCode,
      accountName: line.accountName,
      accountType: line.accountType,
      periodNo: line.periodNo,
      costCenterCode: line.costCenterCode,
      budget: toDb(budget),
      actual: toDb(actual),
      variance: toDb(variance),
      realizationPct: budget.isZero() ? null : toDb(actual.times(100).div(budget)),
    });
  }

  return {
    budget: {
      id: header.id,
      name: header.name,
      docNo: header.docNo,
      status: header.status,
      fiscalYearCode: header.fiscalYearCode,
      branchId: header.branchId,
    },
    range: { from: header.fyStart, to: header.fyEnd },
    periodFilter: query.periodId ?? null,
    lines: items,
    totals: {
      budget: toDb(totalBudget),
      actual: toDb(totalActual),
      variance: toDb(totalActual.minus(totalBudget)),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Laporan arus kas — metode langsung (Tahap 4I)                      */
/* ------------------------------------------------------------------ */

/** Section arus kas dari tipe akun lawan transaksi kas. */
function cashFlowSection(type: AccountType): "operating" | "investing" | "financing" {
  if (type === "revenue" || type === "expense") return "operating";
  if (type === "asset") return "investing";
  return "financing";
}

/**
 * Laporan arus kas metode langsung, disusun dari `cash_transactions` berstatus
 * `posted`. Transfer antar rekening internal dikecualikan (neto nol terhadap kas).
 * Direkonsiliasi terhadap perubahan saldo GL kas/bank; selisih (jurnal manual /
 * saldo awal yang menyentuh akun kas) tampil sebagai "pergerakan lain".
 */
export async function cashFlowStatement(
  actor: AuthContext,
  query: CashFlowQuery,
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.reports.read");

  const reader: Reader = externalTx ?? db;
  const range = await resolveRange(reader, query);
  const branchId = query.branchId ?? null;

  const rows = await reader
    .select({
      type: cashTransactions.type,
      amount: cashTransactions.amount,
      contraAccountId: cashTransactions.contraAccountId,
      contraAccountCode: chartAccounts.code,
      contraAccountName: chartAccounts.name,
      contraAccountType: chartAccounts.type,
    })
    .from(cashTransactions)
    .leftJoin(chartAccounts, eq(chartAccounts.id, cashTransactions.contraAccountId))
    .where(
      and(
        eq(cashTransactions.status, "posted"),
        gte(cashTransactions.transactionDate, range.from),
        lte(cashTransactions.transactionDate, range.to),
        branchId === null ? undefined : eq(cashTransactions.branchId, branchId),
      ),
    );

  interface AccGroup {
    code: string;
    name: string;
    inflow: Money;
    outflow: Money;
  }
  const sections = {
    operating: new Map<string, AccGroup>(),
    investing: new Map<string, AccGroup>(),
    financing: new Map<string, AccGroup>(),
  };
  let transfers = dec(0);

  for (const row of rows) {
    if (row.type === "transfer") {
      transfers = transfers.plus(dec(row.amount));
      continue;
    }
    const contraType = row.contraAccountType as AccountType;
    const section = sections[cashFlowSection(contraType)];
    const key = row.contraAccountId as string;
    let group = section.get(key);
    if (!group) {
      group = { code: row.contraAccountCode as string, name: row.contraAccountName as string, inflow: dec(0), outflow: dec(0) };
      section.set(key, group);
    }
    if (row.type === "receipt") group.inflow = group.inflow.plus(dec(row.amount));
    else group.outflow = group.outflow.plus(dec(row.amount));
  }

  const buildSection = (map: Map<string, AccGroup>) => {
    const lines = [...map.values()]
      .sort((a, b) => byCode(a, b))
      .map((g) => ({
        code: g.code,
        name: g.name,
        inflow: toDb(g.inflow),
        outflow: toDb(g.outflow),
        net: toDb(g.inflow.minus(g.outflow)),
      }));
    const inflow = [...map.values()].reduce<Money>((acc, g) => acc.plus(g.inflow), dec(0));
    const outflow = [...map.values()].reduce<Money>((acc, g) => acc.plus(g.outflow), dec(0));
    return { lines, inflow: toDb(inflow), outflow: toDb(outflow), net: toDb(inflow.minus(outflow)) };
  };

  const operating = buildSection(sections.operating);
  const investing = buildSection(sections.investing);
  const financing = buildSection(sections.financing);
  const netFromTransactions = dec(operating.net).plus(dec(investing.net)).plus(dec(financing.net));

  // Rekonsiliasi: perubahan bersih saldo GL seluruh akun kas/bank.
  const cashAccounts = await reader
    .select({
      id: bankAccounts.id,
      code: bankAccounts.code,
      name: bankAccounts.name,
      kind: bankAccounts.kind,
      accountId: bankAccounts.accountId,
    })
    .from(bankAccounts);

  let opening = dec(0);
  let closing = dec(0);
  const byAccount: { code: string; name: string; kind: string; opening: string; closing: string }[] = [];
  for (const account of cashAccounts) {
    const openRows = await fetchLedgerRows(reader, { accountId: account.accountId, dateBefore: range.from, branchId: branchId ?? undefined });
    const moveRows = await fetchLedgerRows(reader, { accountId: account.accountId, dateFrom: range.from, dateTo: range.to, branchId: branchId ?? undefined });
    const openBal = sumSignedDebitCredit(openRows);
    const closeBal = openBal.plus(sumSignedDebitCredit(moveRows));
    opening = opening.plus(openBal);
    closing = closing.plus(closeBal);
    byAccount.push({ code: account.code, name: account.name, kind: account.kind, opening: toDb(openBal), closing: toDb(closeBal) });
  }
  const netGlChange = closing.minus(opening);
  const otherMovements = netGlChange.minus(netFromTransactions);

  return {
    range,
    branchId,
    method: "direct",
    operating,
    investing,
    financing,
    netChangeFromTransactions: toDb(netFromTransactions),
    internalTransfers: toDb(transfers),
    reconciliation: {
      openingCash: toDb(opening),
      netChangeFromTransactions: toDb(netFromTransactions),
      otherMovements: toDb(otherMovements),
      netGlChange: toDb(netGlChange),
      closingCash: toDb(closing),
      reconciles: toDb(opening.plus(netGlChange)) === toDb(closing),
    },
    cashByAccount: byAccount,
  };
}
