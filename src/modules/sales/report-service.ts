import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import {
  crmAccounts,
  customerInvoices,
  customerPaymentAllocations,
  customerPayments,
  customers,
  journalEntries,
  journalEntryLines,
  salesCreditNotes,
  salesDeliveries,
  salesDeliveryLines,
  salesOrderLines,
  salesOrders,
  stockCostLayers,
} from "@/db/schema";
import { resolveArAccountIds } from "@/modules/sales/ar-account-config";
import type {
  ArAgingQuery,
  ArReconciliationQuery,
  SalesReportQuery,
} from "@/modules/sales/report-schemas";
import { cmp, dec, sum, toDb, type Money } from "@/lib/money";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { forbidden } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Tx | typeof db;

const TOTAL_DP = 2;
const QTY_DP = 3;

const LEDGER_STATUSES = ["posted", "reversed"] as const;

/**
 * Laporan penjualan & AR (Tahap 6F), read-only. Aging & rekonsiliasi memakai
 * angka basis (mata uang pembukuan). Sumber subledger: invoice/pembayaran/nota
 * kredit posted; sumber GL: baris jurnal posted+reversed (reversal saling
 * meniadakan). Pola mirror rekonsiliasi AP (Tahap 5H), sisi piutang.
 */

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

/* ------------------------------- Aging AR ------------------------------ */

interface AgingBucket {
  key: string;
  label: string;
  count: number;
  amount: Money;
}

/** Batas atas (inklusif) hari lewat jatuh tempo per ember; `current` = belum tagih. */
const AGING_BUCKETS = [
  { key: "current", label: "Belum jatuh tempo", max: 0 },
  { key: "1-30", label: "1-30 hari", max: 30 },
  { key: "31-60", label: "31-60 hari", max: 60 },
  { key: "61-90", label: "61-90 hari", max: 90 },
  { key: "90+", label: "> 90 hari", max: Number.POSITIVE_INFINITY },
] as const;

function bucketFor(daysOverdue: number): { key: string; label: string } {
  const found = AGING_BUCKETS.find((b) => daysOverdue <= b.max) ?? AGING_BUCKETS[4];
  return { key: found.key, label: found.label };
}

export async function arAging(actor: AuthContext, query: ArAgingQuery, externalTx?: Tx) {
  assertCan(actor, "sales.ar.read");
  const reader = externalTx ?? db;
  const asOf = query.asOf ?? new Date().toISOString().slice(0, 10);

  const invoices = await reader
    .select({
      id: customerInvoices.id,
      docNo: customerInvoices.docNo,
      customerId: customerInvoices.customerId,
      customerCode: customers.code,
      customerName: crmAccounts.name,
      currency: customerInvoices.currency,
      dueDate: customerInvoices.dueDate,
      exchangeRate: customerInvoices.exchangeRate,
      totalBase: customerInvoices.totalBase,
    })
    .from(customerInvoices)
    .innerJoin(customers, eq(customers.id, customerInvoices.customerId))
    .innerJoin(crmAccounts, eq(crmAccounts.id, customers.crmAccountId))
    .where(
      and(
        eq(customerInvoices.status, "posted"),
        query.customerId === undefined ? undefined : eq(customerInvoices.customerId, query.customerId),
        query.branchId === undefined ? undefined : eq(customerInvoices.branchId, query.branchId),
      ),
    )
    .orderBy(asc(customerInvoices.dueDate), asc(customerInvoices.id));

  const ids = invoices.map((i) => i.id);
  const allocated = await allocatedBaseByInvoice(reader, ids);
  const credited = await creditedBaseByInvoice(reader, ids);

  const buckets = new Map<string, AgingBucket>(
    AGING_BUCKETS.map((b) => [b.key, { key: b.key, label: b.label, count: 0, amount: dec(0) }]),
  );
  const rows: Array<Record<string, string | number | null>> = [];
  let total = dec(0);

  for (const inv of invoices) {
    const remainingBase = dec(inv.totalBase)
      .minus(allocated.get(inv.id) ?? dec(0))
      .minus(credited.get(inv.id) ?? dec(0));
    if (cmp(remainingBase, "0") <= 0) continue;
    const rate = inv.exchangeRate ?? "1.000000";
    const remainingForeign = remainingBase.div(dec(rate));
    const daysOverdue = daysBetween(inv.dueDate, asOf);
    const bucket = bucketFor(daysOverdue);
    const entry = buckets.get(bucket.key);
    if (entry) {
      entry.count += 1;
      entry.amount = entry.amount.plus(remainingBase);
    }
    total = total.plus(remainingBase);
    rows.push({
      invoiceId: inv.id,
      docNo: inv.docNo,
      customerId: inv.customerId,
      customerCode: inv.customerCode,
      customerName: inv.customerName,
      currency: inv.currency,
      dueDate: inv.dueDate,
      daysOverdue,
      bucket: bucket.key,
      remainingBase: toDb(remainingBase, TOTAL_DP),
      remainingForeign: toDb(remainingForeign, TOTAL_DP),
    });
  }

  return {
    asOf,
    totalOutstandingBase: toDb(total, TOTAL_DP),
    buckets: AGING_BUCKETS.map((b) => {
      const entry = buckets.get(b.key) as AgingBucket;
      return { key: entry.key, label: entry.label, count: entry.count, amount: toDb(entry.amount, TOTAL_DP) };
    }),
    rows,
  };
}

/** Total alokasi (basis) per invoice dari pembayaran posted. */
async function allocatedBaseByInvoice(reader: Reader, invoiceIds: string[]): Promise<Map<string, Money>> {
  if (invoiceIds.length === 0) return new Map();
  const rows = await reader
    .select({
      invoiceId: customerPaymentAllocations.invoiceId,
      allocated: sql<string>`coalesce(sum(${customerPaymentAllocations.amountBase}), '0')`,
    })
    .from(customerPaymentAllocations)
    .innerJoin(customerPayments, eq(customerPayments.id, customerPaymentAllocations.paymentId))
    .where(
      and(
        inArray(customerPaymentAllocations.invoiceId, invoiceIds),
        eq(customerPayments.status, "posted"),
      ),
    )
    .groupBy(customerPaymentAllocations.invoiceId);
  return new Map(rows.map((r) => [r.invoiceId, dec(r.allocated)]));
}

/** Total nota kredit (basis) per invoice dari credit note posted. */
async function creditedBaseByInvoice(reader: Reader, invoiceIds: string[]): Promise<Map<string, Money>> {
  if (invoiceIds.length === 0) return new Map();
  const rows = await reader
    .select({
      invoiceId: salesCreditNotes.invoiceId,
      credited: sql<string>`coalesce(sum(${salesCreditNotes.totalBase}), '0')`,
    })
    .from(salesCreditNotes)
    .where(
      and(
        inArray(salesCreditNotes.invoiceId, invoiceIds),
        eq(salesCreditNotes.status, "posted"),
      ),
    )
    .groupBy(salesCreditNotes.invoiceId);
  return new Map(rows.map((r) => [r.invoiceId, dec(r.credited)]));
}

/* --------------------------- Laporan penjualan -------------------------- */

interface CustomerAgg {
  customerId: string;
  customerCode: string;
  customerName: string;
  soCount: number;
  soValue: Money;
  deliveredQty: Money;
  deliveredValue: Money;
  invoiceCount: number;
  invoiceValue: Money;
  creditValue: Money;
  paymentCount: number;
  paymentValue: Money;
}

export async function salesReport(actor: AuthContext, query: SalesReportQuery, externalTx?: Tx) {
  assertCan(actor, "sales.reports.read");
  const reader = externalTx ?? db;

  const soConditions = [
    eq(salesOrders.status, "posted"),
    query.customerId === undefined ? undefined : eq(salesOrders.customerId, query.customerId),
    query.branchId === undefined ? undefined : eq(salesOrders.branchId, query.branchId),
    query.from === undefined ? undefined : gte(salesOrders.orderDate, query.from),
    query.to === undefined ? undefined : lte(salesOrders.orderDate, query.to),
  ];

  const soRows = await reader
    .select({
      customerId: salesOrders.customerId,
      customerCode: customers.code,
      customerName: crmAccounts.name,
      soCount: sql<number>`count(*)::int`,
      soValue: sql<string>`coalesce(sum(${salesOrders.totalBase}), 0)::numeric(18,2)`,
    })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .innerJoin(crmAccounts, eq(crmAccounts.id, customers.crmAccountId))
    .where(and(...soConditions))
    .groupBy(salesOrders.customerId, customers.code, crmAccounts.name);

  const deliveryConditions = [
    eq(salesDeliveries.status, "posted"),
    query.customerId === undefined ? undefined : eq(salesDeliveries.customerId, query.customerId),
    query.branchId === undefined ? undefined : eq(salesDeliveries.branchId, query.branchId),
    query.from === undefined ? undefined : gte(salesDeliveries.deliveryDate, query.from),
    query.to === undefined ? undefined : lte(salesDeliveries.deliveryDate, query.to),
  ];
  const deliveredRows = await reader
    .select({
      customerId: salesDeliveries.customerId,
      deliveredQty: sql<string>`coalesce(sum(${salesDeliveryLines.quantity}), 0)::numeric(18,3)`,
      deliveredValue: sql<string>`coalesce(sum(${salesOrderLines.baseAmount} * ${salesDeliveryLines.quantity} / nullif(${salesOrderLines.quantity}, 0)), 0)::numeric(18,2)`,
    })
    .from(salesDeliveryLines)
    .innerJoin(salesDeliveries, eq(salesDeliveries.id, salesDeliveryLines.deliveryId))
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, salesDeliveryLines.soLineId))
    .where(and(...deliveryConditions))
    .groupBy(salesDeliveries.customerId);

  const invoiceConditions = [
    eq(customerInvoices.status, "posted"),
    query.customerId === undefined ? undefined : eq(customerInvoices.customerId, query.customerId),
    query.branchId === undefined ? undefined : eq(customerInvoices.branchId, query.branchId),
    query.from === undefined ? undefined : gte(customerInvoices.invoiceDate, query.from),
    query.to === undefined ? undefined : lte(customerInvoices.invoiceDate, query.to),
  ];
  const invoiceRows = await reader
    .select({
      customerId: customerInvoices.customerId,
      invoiceCount: sql<number>`count(*)::int`,
      invoiceValue: sql<string>`coalesce(sum(${customerInvoices.totalBase}), 0)::numeric(18,2)`,
    })
    .from(customerInvoices)
    .where(and(...invoiceConditions))
    .groupBy(customerInvoices.customerId);

  const creditConditions = [
    eq(salesCreditNotes.status, "posted"),
    query.customerId === undefined ? undefined : eq(salesCreditNotes.customerId, query.customerId),
    query.branchId === undefined ? undefined : eq(salesCreditNotes.branchId, query.branchId),
    query.from === undefined ? undefined : gte(salesCreditNotes.creditNoteDate, query.from),
    query.to === undefined ? undefined : lte(salesCreditNotes.creditNoteDate, query.to),
  ];
  const creditRows = await reader
    .select({
      customerId: salesCreditNotes.customerId,
      creditValue: sql<string>`coalesce(sum(${salesCreditNotes.totalBase}), 0)::numeric(18,2)`,
    })
    .from(salesCreditNotes)
    .where(and(...creditConditions))
    .groupBy(salesCreditNotes.customerId);

  const paymentConditions = [
    eq(customerPayments.status, "posted"),
    query.customerId === undefined ? undefined : eq(customerPayments.customerId, query.customerId),
    query.branchId === undefined ? undefined : eq(customerPayments.branchId, query.branchId),
    query.from === undefined ? undefined : gte(customerPayments.paymentDate, query.from),
    query.to === undefined ? undefined : lte(customerPayments.paymentDate, query.to),
  ];
  const paymentRows = await reader
    .select({
      customerId: customerPayments.customerId,
      paymentCount: sql<number>`count(*)::int`,
      paymentValue: sql<string>`coalesce(sum(${customerPayments.amountBase}), 0)::numeric(18,2)`,
    })
    .from(customerPayments)
    .where(and(...paymentConditions))
    .groupBy(customerPayments.customerId);

  const byCustomer = new Map<string, CustomerAgg>();
  const ensure = (id: string, code = "", name = ""): CustomerAgg => {
    let agg = byCustomer.get(id);
    if (!agg) {
      agg = {
        customerId: id,
        customerCode: code,
        customerName: name,
        soCount: 0,
        soValue: dec(0),
        deliveredQty: dec(0),
        deliveredValue: dec(0),
        invoiceCount: 0,
        invoiceValue: dec(0),
        creditValue: dec(0),
        paymentCount: 0,
        paymentValue: dec(0),
      };
      byCustomer.set(id, agg);
    }
    if (code && !agg.customerCode) {
      agg.customerCode = code;
      agg.customerName = name;
    }
    return agg;
  };

  for (const r of soRows) {
    const agg = ensure(r.customerId, r.customerCode, r.customerName);
    agg.soCount = r.soCount;
    agg.soValue = dec(r.soValue);
  }
  for (const r of deliveredRows) {
    const agg = ensure(r.customerId);
    agg.deliveredQty = dec(r.deliveredQty);
    agg.deliveredValue = dec(r.deliveredValue);
  }
  for (const r of invoiceRows) {
    const agg = ensure(r.customerId);
    agg.invoiceCount = r.invoiceCount;
    agg.invoiceValue = dec(r.invoiceValue);
  }
  for (const r of creditRows) {
    const agg = ensure(r.customerId);
    agg.creditValue = dec(r.creditValue);
  }
  for (const r of paymentRows) {
    const agg = ensure(r.customerId);
    agg.paymentCount = r.paymentCount;
    agg.paymentValue = dec(r.paymentValue);
  }

  const rows = [...byCustomer.values()]
    .sort((a, b) => (a.customerCode < b.customerCode ? -1 : a.customerCode > b.customerCode ? 1 : 0))
    .map((agg) => ({
      customerId: agg.customerId,
      customerCode: agg.customerCode,
      customerName: agg.customerName,
      soCount: agg.soCount,
      soValue: toDb(agg.soValue, TOTAL_DP),
      deliveredQty: toDb(agg.deliveredQty, QTY_DP),
      deliveredValue: toDb(agg.deliveredValue, TOTAL_DP),
      invoiceCount: agg.invoiceCount,
      invoiceValue: toDb(agg.invoiceValue, TOTAL_DP),
      creditValue: toDb(agg.creditValue, TOTAL_DP),
      paymentCount: agg.paymentCount,
      paymentValue: toDb(agg.paymentValue, TOTAL_DP),
      outstanding: toDb(agg.invoiceValue.minus(agg.paymentValue).minus(agg.creditValue), TOTAL_DP),
    }));

  return {
    from: query.from ?? null,
    to: query.to ?? null,
    totals: {
      soCount: sum(rows.map((r) => r.soCount)).toNumber(),
      soValue: toDb(sum(rows.map((r) => r.soValue)), TOTAL_DP),
      invoiceValue: toDb(sum(rows.map((r) => r.invoiceValue)), TOTAL_DP),
      creditValue: toDb(sum(rows.map((r) => r.creditValue)), TOTAL_DP),
      paymentValue: toDb(sum(rows.map((r) => r.paymentValue)), TOTAL_DP),
      outstanding: toDb(sum(rows.map((r) => r.outstanding)), TOTAL_DP),
    },
    rows,
  };
}

/* ------------------------- Rekonsiliasi GL ↔ subledger ------------------------ */

export async function arGlReconciliation(actor: AuthContext, _query: ArReconciliationQuery, externalTx?: Tx) {
  assertCan(actor, "sales.reports.read");
  const reader = externalTx ?? db;
  const { arAccountId, inventoryAccountId } = await resolveArAccountIds(reader);

  // Subledger.
  const [invoiceAgg] = await reader
    .select({ total: sql<string>`coalesce(sum(${customerInvoices.totalBase}), 0)::numeric(18,2)` })
    .from(customerInvoices)
    .where(eq(customerInvoices.status, "posted"));
  const [paymentAgg] = await reader
    .select({ total: sql<string>`coalesce(sum(${customerPayments.amountBase}), 0)::numeric(18,2)` })
    .from(customerPayments)
    .where(eq(customerPayments.status, "posted"));
  const [creditAgg] = await reader
    .select({ total: sql<string>`coalesce(sum(${salesCreditNotes.totalBase}), 0)::numeric(18,2)` })
    .from(salesCreditNotes)
    .where(eq(salesCreditNotes.status, "posted"));
  const [layerAgg] = await reader
    .select({
      value: sql<string>`coalesce(sum(${stockCostLayers.quantityRemaining} * ${stockCostLayers.unitCost}), 0)::numeric(18,2)`,
    })
    .from(stockCostLayers);

  const invoicePosted = dec(invoiceAgg?.total ?? "0");
  const paymentPosted = dec(paymentAgg?.total ?? "0");
  const creditPosted = dec(creditAgg?.total ?? "0");
  const inventorySubledger = dec(layerAgg?.value ?? "0");

  const arSubledger = invoicePosted.minus(paymentPosted).minus(creditPosted);

  // GL.
  const arGl = await glNet(reader, arAccountId);
  const invGl = await glNet(reader, inventoryAccountId);

  const arGlNet = arGl.debit.minus(arGl.credit); // aset: normal debit
  const invGlNet = invGl.debit.minus(invGl.credit); // aset: normal debit

  const line = (label: string, subledger: Money, gl: Money) => {
    const difference = subledger.minus(gl);
    return {
      label,
      subledger: toDb(subledger, TOTAL_DP),
      gl: toDb(gl, TOTAL_DP),
      difference: toDb(difference, TOTAL_DP),
      matched: cmp(difference, "0") === 0,
    };
  };

  const lines = [
    line("Piutang usaha (AR)", arSubledger, arGlNet),
    line("Persediaan (Inventory)", inventorySubledger, invGlNet),
  ];

  return {
    accounts: { arAccountId, inventoryAccountId },
    inputs: {
      invoicePostedTotalBase: toDb(invoicePosted, TOTAL_DP),
      paymentPostedTotalBase: toDb(paymentPosted, TOTAL_DP),
      creditNotePostedTotalBase: toDb(creditPosted, TOTAL_DP),
      inventoryLayerValue: toDb(inventorySubledger, TOTAL_DP),
    },
    lines,
    balanced: lines.every((l) => l.matched),
  };
}

/** Total debit & kredit sebuah akun pada jurnal posted+reversed. */
async function glNet(reader: Reader, accountId: string): Promise<{ debit: Money; credit: Money }> {
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
  return { debit: dec(row?.debit ?? "0"), credit: dec(row?.credit ?? "0") };
}

/* ------------------------------ Util tanggal ----------------------------- */

/** Selisih hari ISO (b - a); > 0 bila a sudah lewat terhadap b. */
function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}
