import { and, asc, eq, gte, lte, type SQL } from "drizzle-orm";
import { z } from "zod";

import { accountingPeriods } from "@/db/schema";
import { budgetRealization, incomeStatement } from "@/modules/accounting/report-service";
import { reorderReport } from "@/modules/inventory/report-service";
import { arAging, salesReport } from "@/modules/sales/report-service";
import { cmp, dec, sum, toDb } from "@/lib/money";
import type { CsvRow } from "@/modules/reporting/csv";
import { can, type AuthContext, type Grant, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { isoDateSchema, uuidSchema } from "@/server/validation";

import type { Reader, Tx } from "./_refs";

/* ------------------------------------------------------------------ */
/* Registri ANALISIS deterministik (Tahap 9D).                          */
/* Setiap entri membungkus service laporan yang SUDAH ada lalu           */
/* menghitung tren/varians/anomali secara deterministik (desimal).       */
/* AI TIDAK menghitung dan TIDAK menulis SQL: ia hanya menjelaskan       */
/* `metrics`/`series`/`flags` yang sudah dihitung di sini. Pola cermin   */
/* export-catalog: {key,label,permission,parseParams,compute}.           */
/* Izin sumber ditegakkan dua kali: oleh asisten (can) & oleh service.    */
/* ------------------------------------------------------------------ */

/** Inti hasil analisis (angka deterministik) — label/params/source ditambahkan wrapper. */
type AnalysisCore = {
  metrics: Record<string, string | number>;
  series?: CsvRow[];
  flags?: CsvRow[];
};

export type AnalysisOutcome = {
  analysisKey: string;
  analysisLabel: string;
  /** Parameter sudah divalidasi (hanya skalir aman: tanggal/uuid/angka). */
  params: Record<string, unknown>;
  source: "deterministic service";
} & AnalysisCore;

/** Versi type-erased yang dipakai asisten (satu titik type-erase terkendali). */
export type AnalysisEntry = {
  key: string;
  label: string;
  permission: PermissionCode;
  parseParams: (raw: unknown) => unknown;
  compute: (actor: AuthContext, params: unknown, tx?: Tx) => Promise<AnalysisOutcome>;
};

function defineAnalysis<P extends object>(spec: {
  key: string;
  label: string;
  permission: PermissionCode;
  schema: z.ZodType<P>;
  /** Service laporan memakai `tx` (bila ada); baca non-tx memakai `db`. */
  compute: (actor: AuthContext, params: P, tx: Tx | undefined, reader: Reader) => Promise<AnalysisCore>;
}): AnalysisEntry {
  return {
    key: spec.key,
    label: spec.label,
    permission: spec.permission,
    parseParams: (raw) => spec.schema.parse(raw),
    compute: async (actor, params, tx) => {
      const typed = params as P;
      const reader: Reader = tx ?? db;
      const core = await spec.compute(actor, typed, tx, reader);
      return {
        analysisKey: spec.key,
        analysisLabel: spec.label,
        params: (typed ?? {}) as unknown as Record<string, unknown>,
        source: "deterministic service",
        ...core,
      };
    },
  };
}

/* --------------------------- Helper periode --------------------------- */

type PeriodRow = { periodNo: number; startDate: string; endDate: string };

async function listPeriods(reader: Reader, where: SQL | undefined): Promise<PeriodRow[]> {
  return reader
    .select({
      periodNo: accountingPeriods.periodNo,
      startDate: accountingPeriods.startDate,
      endDate: accountingPeriods.endDate,
    })
    .from(accountingPeriods)
    .where(where)
    .orderBy(asc(accountingPeriods.periodNo));
}

/** Rentang dari fiscalYearId ATAU from/to (sudah divalidasi skema). */
function rangeCondition(params: { fiscalYearId?: string; from?: string; to?: string }): SQL | undefined {
  if (params.fiscalYearId) return eq(accountingPeriods.fiscalYearId, params.fiscalYearId);
  return and(
    gte(accountingPeriods.startDate, params.from as string),
    lte(accountingPeriods.endDate, params.to as string),
  );
}

/** Arah tren dari nilai awal vs akhir (deterministik; tanpa data => flat). */
function trendDirection(firstNet: string, lastNet: string): "naik" | "turun" | "flat" {
  const c = cmp(dec(lastNet).minus(dec(firstNet)), "0");
  return c > 0 ? "naik" : c < 0 ? "turun" : "flat";
}

/** Skema periode umum: satu fiscalYearId ATAU pasangan from/to (+ cabang opsional). */
const periodRangeSchema = z
  .strictObject({
    fiscalYearId: uuidSchema.optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    branchId: uuidSchema.optional(),
  })
  .refine((v) => (v.fiscalYearId ? !v.from && !v.to : !!v.from && !!v.to), {
    message: "Berikan fiscalYearId, atau from & to (tidak keduanya).",
  })
  .refine((v) => !v.from || !v.to || v.to >= v.from, { path: ["to"], message: "to tidak boleh sebelum from." });

type PeriodRange = z.output<typeof periodRangeSchema>;

/* ------------------------------ Entri ------------------------------- */

export const ANALYSIS_ENTRIES: readonly AnalysisEntry[] = [
  // Tren laba rugi antar periode (finance). Sumber angka: incomeStatement per periode.
  defineAnalysis<PeriodRange>({
    key: "income-trend",
    label: "Tren Laba Rugi per Periode",
    permission: "accounting.reports.read",
    schema: periodRangeSchema,
    compute: async (actor, params, tx, reader) => {
      const periods = await listPeriods(reader, rangeCondition(params));
      const series: CsvRow[] = [];
      let prevNet = dec(0);
      let firstNet: string | null = null;
      let latestNet = "0.00";
      let totalNet = dec(0);
      let largestChange = dec(0);
      let largestChangePeriodNo: number | null = null;

      for (const p of periods) {
        const inc = await incomeStatement(actor, { from: p.startDate, to: p.endDate, branchId: params.branchId }, tx);
        const net = dec(inc.netIncome);
        const netChange = net.minus(prevNet);
        if (firstNet === null) firstNet = inc.netIncome;
        if (largestChangePeriodNo === null || netChange.abs().gt(largestChange.abs())) {
          largestChange = netChange;
          largestChangePeriodNo = p.periodNo;
        }
        totalNet = totalNet.plus(net);
        latestNet = inc.netIncome;
        series.push({
          periodNo: p.periodNo,
          periodStart: p.startDate,
          periodEnd: p.endDate,
          revenue: inc.totalRevenue,
          expense: inc.totalExpense,
          net: inc.netIncome,
          netChange: toDb(netChange),
        });
        prevNet = net;
      }

      const metrics: Record<string, string | number> = {
        periodCount: series.length,
        direction: firstNet === null ? "flat" : trendDirection(firstNet, latestNet),
        latestNet,
        totalNet: toDb(totalNet),
        largestChangePeriodNo: largestChangePeriodNo ?? "",
        largestChange: toDb(largestChange),
      };
      return { metrics, series };
    },
  }),

  // Varians anggaran vs realisasi (anomali keuangan). Sumber: budgetRealization.
  defineAnalysis<{ budgetId: string; periodId?: string; variancePctThreshold: number }>({
    key: "budget-variance",
    label: "Anomali Varians Anggaran",
    permission: "accounting.budgets.read",
    schema: z.strictObject({
      budgetId: uuidSchema,
      periodId: uuidSchema.optional(),
      variancePctThreshold: z.coerce.number().int().min(0).max(1000).default(10),
    }),
    compute: async (actor, params, tx) => {
      const report = await budgetRealization(actor, { budgetId: params.budgetId, periodId: params.periodId }, tx);
      const flags: CsvRow[] = [];
      let totalVariance = dec(0);
      for (const line of report.lines) {
        const budgetV = dec(line.budget);
        const varianceV = dec(line.variance);
        totalVariance = totalVariance.plus(varianceV);
        let variancePct: string | null;
        if (budgetV.isZero()) {
          variancePct = varianceV.isZero() ? "0.00" : null; // anggaran nol tapi ada realisasi = anomali
        } else {
          variancePct = toDb(varianceV.abs().times(100).div(budgetV.abs()));
        }
        const overThreshold = variancePct === null ? !varianceV.isZero() : dec(variancePct).gt(dec(params.variancePctThreshold));
        if (overThreshold) {
          flags.push({
            accountCode: line.accountCode,
            accountName: line.accountName,
            periodNo: line.periodNo,
            budget: line.budget,
            actual: line.actual,
            variance: line.variance,
            variancePct: variancePct ?? "tak-beranggaran",
          });
        }
      }
      // Urutkan berdasarkan besaran varians (abs desc) agar anomali terbesar lebih dulu.
      flags.sort((a, b) => dec(b.variance as string).abs().comparedTo(dec(a.variance as string).abs()));
      const metrics: Record<string, string | number> = {
        lineCount: report.lines.length,
        flaggedCount: flags.length,
        thresholdPct: params.variancePctThreshold,
        totalVariance: toDb(totalVariance),
      };
      return { metrics, flags };
    },
  }),

  // Tren penjualan antar periode (sales). Sumber: salesReport per periode.
  defineAnalysis<PeriodRange>({
    key: "sales-trend",
    label: "Tren Penjualan per Periode",
    permission: "sales.reports.read",
    schema: periodRangeSchema,
    compute: async (actor, params, tx, reader) => {
      const periods = await listPeriods(reader, rangeCondition(params));
      const series: CsvRow[] = [];
      let prevInvoice = dec(0);
      let firstInvoice: string | null = null;
      let latestInvoice = "0.00";
      let totalInvoice = dec(0);
      for (const p of periods) {
        const rep = await salesReport(actor, { from: p.startDate, to: p.endDate, branchId: params.branchId }, tx);
        const invoice = dec(rep.totals.invoiceValue);
        if (firstInvoice === null) firstInvoice = rep.totals.invoiceValue;
        latestInvoice = rep.totals.invoiceValue;
        totalInvoice = totalInvoice.plus(invoice);
        series.push({
          periodNo: p.periodNo,
          periodStart: p.startDate,
          periodEnd: p.endDate,
          invoiceValue: rep.totals.invoiceValue,
          outstanding: rep.totals.outstanding,
          invoiceChange: toDb(invoice.minus(prevInvoice)),
        });
        prevInvoice = invoice;
      }
      const metrics: Record<string, string | number> = {
        periodCount: series.length,
        direction: firstInvoice === null ? "flat" : trendDirection(firstInvoice, latestInvoice),
        latestInvoiceValue: latestInvoice,
        totalInvoiceValue: toDb(totalInvoice),
      };
      return { metrics, series };
    },
  }),

  // Risiko penagihan AR (anomali). Sumber: arAging — hanya ember agregat (tanpa nama pelanggan).
  defineAnalysis<{ asOf?: string; branchId?: string; customerId?: string }>({
    key: "ar-aging-risk",
    label: "Risiko Umur Piutang",
    permission: "sales.ar.read",
    schema: z.strictObject({
      asOf: isoDateSchema.optional(),
      branchId: uuidSchema.optional(),
      customerId: uuidSchema.optional(),
    }),
    compute: async (actor, params, tx) => {
      const report = await arAging(actor, { asOf: params.asOf, branchId: params.branchId, customerId: params.customerId }, tx);
      const flags: CsvRow[] = [];
      let pastDueAmount = dec(0);
      let pastDueCount = 0;
      let over90Amount = dec(0);
      for (const bucket of report.buckets) {
        if (bucket.key === "current") continue;
        pastDueAmount = pastDueAmount.plus(dec(bucket.amount));
        pastDueCount += bucket.count;
        if (bucket.key === "90+") over90Amount = dec(bucket.amount);
        flags.push({ bucket: bucket.key, label: bucket.label, count: bucket.count, amount: bucket.amount });
      }
      const total = dec(report.totalOutstandingBase);
      const over90Share = pastDueAmount.isZero() ? dec(0) : over90Amount.times(100).div(pastDueAmount);
      const metrics: Record<string, string | number> = {
        asOf: report.asOf,
        totalOutstanding: report.totalOutstandingBase,
        pastDueAmount: toDb(pastDueAmount),
        pastDueCount,
        over90Amount: toDb(over90Amount),
        over90SharePct: toDb(over90Share),
        // Penanda anomali sederhana: sebagian besar piutang lewat jatuh tempo & total tak nol.
        elevatedRisk: !total.isZero() && pastDueAmount.times(100).gt(total.times(50)) ? "yes" : "no",
      };
      return { metrics, flags };
    },
  }),

  // Risiko kehabisan stok (anomali inventory). Sumber: reorderReport.
  defineAnalysis<{ warehouseId?: string; branchId?: string; productId?: string }>({
    key: "inventory-reorder-risk",
    label: "Risiko Reorder Persediaan",
    permission: "inventory.stock.read",
    schema: z.strictObject({
      warehouseId: uuidSchema.optional(),
      branchId: uuidSchema.optional(),
      productId: uuidSchema.optional(),
    }),
    compute: async (actor, params, tx) => {
      const report = await reorderReport(
        actor,
        { warehouseId: params.warehouseId, branchId: params.branchId, productId: params.productId },
        tx,
      );
      const flags: CsvRow[] = report.rows.map((r) => ({
        productSku: r.productSku,
        reorderPoint: r.reorderPoint,
        onHand: r.onHand,
        suggestedQuantity: r.suggestedQuantity,
      }));
      const metrics: Record<string, string | number> = {
        belowCount: report.count,
        totalSuggestedQuantity: toDb(sum(report.rows.map((r) => r.suggestedQuantity)), 3),
      };
      return { metrics, flags };
    },
  }),
];

const BY_KEY = new Map(ANALYSIS_ENTRIES.map((entry) => [entry.key, entry]));

export function findAnalysis(key: string): AnalysisEntry | undefined {
  return BY_KEY.get(key);
}

/** Katalog analisis (metadata saja) untuk UI/prompt. */
export function listAnalysisCatalog() {
  return ANALYSIS_ENTRIES.map((entry) => ({ key: entry.key, label: entry.label, permission: entry.permission }));
}

/** Analisis yang DIIZINKAN actor — model tidak pernah melihat yang lain. */
export function permittedAnalyses(grants: readonly Grant[]): AnalysisEntry[] {
  return ANALYSIS_ENTRIES.filter((entry) => can(grants, entry.permission));
}
