import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import {
  apPaymentAllocations,
  apPayments,
  journalEntries,
  journalEntryLines,
  purchaseOrderLines,
  purchaseOrders,
  stockCostLayers,
  supplierInvoices,
  suppliers,
} from "@/db/schema";
import { resolveApAccountIds } from "@/modules/purchasing/ap-account-config";
import type {
  ApAgingQuery,
  ApReconciliationQuery,
  PurchaseReportQuery,
} from "@/modules/purchasing/report-schemas";
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
 * Laporan pembelian & AP (Tahap 5H), read-only. Aging & rekonsiliasi memakai
 * angka basis (mata uang pembukuan). Sumber subledger: invoice/pembayaran posted;
 * sumber GL: baris jurnal posted+reversed (reversal saling meniadakan).
 */

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

/* ------------------------------- Aging AP ------------------------------ */

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

export async function apAging(actor: AuthContext, query: ApAgingQuery, externalTx?: Tx) {
  assertCan(actor, "purchasing.ap.read");
  const reader = externalTx ?? db;
  const asOf = query.asOf ?? new Date().toISOString().slice(0, 10);

  const invoices = await reader
    .select({
      id: supplierInvoices.id,
      docNo: supplierInvoices.docNo,
      supplierId: supplierInvoices.supplierId,
      supplierCode: suppliers.code,
      supplierName: suppliers.name,
      currency: supplierInvoices.currency,
      dueDate: supplierInvoices.dueDate,
      exchangeRate: supplierInvoices.exchangeRate,
      totalBase: supplierInvoices.totalBase,
    })
    .from(supplierInvoices)
    .innerJoin(suppliers, eq(suppliers.id, supplierInvoices.supplierId))
    .where(
      and(
        eq(supplierInvoices.status, "posted"),
        query.supplierId === undefined ? undefined : eq(supplierInvoices.supplierId, query.supplierId),
        query.branchId === undefined ? undefined : eq(supplierInvoices.branchId, query.branchId),
      ),
    )
    .orderBy(asc(supplierInvoices.dueDate), asc(supplierInvoices.id));

  const allocated = await allocatedBaseByInvoice(
    reader,
    invoices.map((i) => i.id),
  );

  const buckets = new Map<string, AgingBucket>(
    AGING_BUCKETS.map((b) => [b.key, { key: b.key, label: b.label, count: 0, amount: dec(0) }]),
  );
  const rows: Array<Record<string, string | number | null>> = [];
  let total = dec(0);

  for (const inv of invoices) {
    const remainingBase = dec(inv.totalBase).minus(allocated.get(inv.id) ?? dec(0));
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
      supplierId: inv.supplierId,
      supplierCode: inv.supplierCode,
      supplierName: inv.supplierName,
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
      invoiceId: apPaymentAllocations.invoiceId,
      allocated: sql<string>`coalesce(sum(${apPaymentAllocations.amountBase}), '0')`,
    })
    .from(apPaymentAllocations)
    .innerJoin(apPayments, eq(apPayments.id, apPaymentAllocations.paymentId))
    .where(
      and(
        inArray(apPaymentAllocations.invoiceId, invoiceIds),
        eq(apPayments.status, "posted"),
      ),
    )
    .groupBy(apPaymentAllocations.invoiceId);
  return new Map(rows.map((r) => [r.invoiceId, dec(r.allocated)]));
}

/* --------------------------- Laporan pembelian -------------------------- */

interface SupplierAgg {
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  poCount: number;
  poValue: Money;
  receivedQty: Money;
  receivedValue: Money;
  invoiceCount: number;
  invoiceValue: Money;
  paymentCount: number;
  paymentValue: Money;
}

export async function purchaseReport(
  actor: AuthContext,
  query: PurchaseReportQuery,
  externalTx?: Tx,
) {
  assertCan(actor, "purchasing.reports.read");
  const reader = externalTx ?? db;

  const poConditions = [
    eq(purchaseOrders.status, "posted"),
    query.supplierId === undefined ? undefined : eq(purchaseOrders.supplierId, query.supplierId),
    query.branchId === undefined ? undefined : eq(purchaseOrders.branchId, query.branchId),
    query.from === undefined ? undefined : gte(purchaseOrders.orderDate, query.from),
    query.to === undefined ? undefined : lte(purchaseOrders.orderDate, query.to),
  ];

  const poRows = await reader
    .select({
      supplierId: purchaseOrders.supplierId,
      supplierCode: suppliers.code,
      supplierName: suppliers.name,
      poCount: sql<number>`count(*)::int`,
      poValue: sql<string>`coalesce(sum(${purchaseOrders.totalBase}), 0)::numeric(18,2)`,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(and(...poConditions))
    .groupBy(purchaseOrders.supplierId, suppliers.code, suppliers.name);

  const receivedRows = await reader
    .select({
      supplierId: purchaseOrders.supplierId,
      receivedQty: sql<string>`coalesce(sum(${purchaseOrderLines.quantityReceived}), 0)::numeric(18,3)`,
      receivedValue: sql<string>`coalesce(sum(${purchaseOrderLines.baseAmount} * ${purchaseOrderLines.quantityReceived} / nullif(${purchaseOrderLines.quantity}, 0)), 0)::numeric(18,2)`,
    })
    .from(purchaseOrderLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.poId))
    .where(and(...poConditions))
    .groupBy(purchaseOrders.supplierId);

  const invoiceConditions = [
    eq(supplierInvoices.status, "posted"),
    query.supplierId === undefined ? undefined : eq(supplierInvoices.supplierId, query.supplierId),
    query.branchId === undefined ? undefined : eq(supplierInvoices.branchId, query.branchId),
    query.from === undefined ? undefined : gte(supplierInvoices.invoiceDate, query.from),
    query.to === undefined ? undefined : lte(supplierInvoices.invoiceDate, query.to),
  ];
  const invoiceRows = await reader
    .select({
      supplierId: supplierInvoices.supplierId,
      invoiceCount: sql<number>`count(*)::int`,
      invoiceValue: sql<string>`coalesce(sum(${supplierInvoices.totalBase}), 0)::numeric(18,2)`,
    })
    .from(supplierInvoices)
    .where(and(...invoiceConditions))
    .groupBy(supplierInvoices.supplierId);

  const paymentConditions = [
    eq(apPayments.status, "posted"),
    query.supplierId === undefined ? undefined : eq(apPayments.supplierId, query.supplierId),
    query.branchId === undefined ? undefined : eq(apPayments.branchId, query.branchId),
    query.from === undefined ? undefined : gte(apPayments.paymentDate, query.from),
    query.to === undefined ? undefined : lte(apPayments.paymentDate, query.to),
  ];
  const paymentRows = await reader
    .select({
      supplierId: apPayments.supplierId,
      paymentCount: sql<number>`count(*)::int`,
      paymentValue: sql<string>`coalesce(sum(${apPayments.amountBase}), 0)::numeric(18,2)`,
    })
    .from(apPayments)
    .where(and(...paymentConditions))
    .groupBy(apPayments.supplierId);

  const bySupplier = new Map<string, SupplierAgg>();
  const ensure = (id: string, code = "", name = ""): SupplierAgg => {
    let agg = bySupplier.get(id);
    if (!agg) {
      agg = {
        supplierId: id,
        supplierCode: code,
        supplierName: name,
        poCount: 0,
        poValue: dec(0),
        receivedQty: dec(0),
        receivedValue: dec(0),
        invoiceCount: 0,
        invoiceValue: dec(0),
        paymentCount: 0,
        paymentValue: dec(0),
      };
      bySupplier.set(id, agg);
    }
    if (code && !agg.supplierCode) {
      agg.supplierCode = code;
      agg.supplierName = name;
    }
    return agg;
  };

  for (const r of poRows) {
    const agg = ensure(r.supplierId, r.supplierCode, r.supplierName);
    agg.poCount = r.poCount;
    agg.poValue = dec(r.poValue);
  }
  for (const r of receivedRows) {
    const agg = ensure(r.supplierId);
    agg.receivedQty = dec(r.receivedQty);
    agg.receivedValue = dec(r.receivedValue);
  }
  for (const r of invoiceRows) {
    const agg = ensure(r.supplierId);
    agg.invoiceCount = r.invoiceCount;
    agg.invoiceValue = dec(r.invoiceValue);
  }
  for (const r of paymentRows) {
    const agg = ensure(r.supplierId);
    agg.paymentCount = r.paymentCount;
    agg.paymentValue = dec(r.paymentValue);
  }

  const rows = [...bySupplier.values()]
    .sort((a, b) => (a.supplierCode < b.supplierCode ? -1 : a.supplierCode > b.supplierCode ? 1 : 0))
    .map((agg) => ({
      supplierId: agg.supplierId,
      supplierCode: agg.supplierCode,
      supplierName: agg.supplierName,
      poCount: agg.poCount,
      poValue: toDb(agg.poValue, TOTAL_DP),
      receivedQty: toDb(agg.receivedQty, QTY_DP),
      receivedValue: toDb(agg.receivedValue, TOTAL_DP),
      invoiceCount: agg.invoiceCount,
      invoiceValue: toDb(agg.invoiceValue, TOTAL_DP),
      paymentCount: agg.paymentCount,
      paymentValue: toDb(agg.paymentValue, TOTAL_DP),
      outstanding: toDb(agg.invoiceValue.minus(agg.paymentValue), TOTAL_DP),
    }));

  return {
    from: query.from ?? null,
    to: query.to ?? null,
    totals: {
      poCount: sum(rows.map((r) => r.poCount)).toNumber(),
      poValue: toDb(sum(rows.map((r) => r.poValue)), TOTAL_DP),
      invoiceValue: toDb(sum(rows.map((r) => r.invoiceValue)), TOTAL_DP),
      paymentValue: toDb(sum(rows.map((r) => r.paymentValue)), TOTAL_DP),
      outstanding: toDb(sum(rows.map((r) => r.outstanding)), TOTAL_DP),
    },
    rows,
  };
}

/* ------------------------- Rekonsiliasi GL ↔ subledger ------------------------ */

export async function apGlReconciliation(
  actor: AuthContext,
  _query: ApReconciliationQuery,
  externalTx?: Tx,
) {
  assertCan(actor, "purchasing.reports.read");
  const reader = externalTx ?? db;
  const { inventoryAccountId, grirAccountId, apAccountId } = await resolveApAccountIds(reader);

  // Subledger.
  const [invoiceAgg] = await reader
    .select({ total: sql<string>`coalesce(sum(${supplierInvoices.totalBase}), 0)::numeric(18,2)` })
    .from(supplierInvoices)
    .where(eq(supplierInvoices.status, "posted"));
  const [paymentAgg] = await reader
    .select({ total: sql<string>`coalesce(sum(${apPayments.amountBase}), 0)::numeric(18,2)` })
    .from(apPayments)
    .where(eq(apPayments.status, "posted"));
  const [layerAgg] = await reader
    .select({
      value: sql<string>`coalesce(sum(${stockCostLayers.quantityRemaining} * ${stockCostLayers.unitCost}), 0)::numeric(18,2)`,
    })
    .from(stockCostLayers);

  const invoicePosted = dec(invoiceAgg?.total ?? "0");
  const paymentPosted = dec(paymentAgg?.total ?? "0");
  const inventorySubledger = dec(layerAgg?.value ?? "0");

  const apSubledger = invoicePosted.minus(paymentPosted);
  const grirSubledger = inventorySubledger.minus(invoicePosted);

  // GL.
  const apGl = await glNet(reader, apAccountId);
  const invGl = await glNet(reader, inventoryAccountId);
  const grirGl = await glNet(reader, grirAccountId);

  const apGlNet = apGl.credit.minus(apGl.debit); // liabilitas: normal kredit
  const invGlNet = invGl.debit.minus(invGl.credit); // aset: normal debit
  const grirGlNet = grirGl.credit.minus(grirGl.debit); // liabilitas: normal kredit

  const line = (
    label: string,
    subledger: Money,
    gl: Money,
  ) => {
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
    line("Utang usaha (AP)", apSubledger, apGlNet),
    line("GR/IR", grirSubledger, grirGlNet),
    line("Persediaan (Inventory)", inventorySubledger, invGlNet),
  ];

  return {
    accounts: { inventoryAccountId, grirAccountId, apAccountId },
    inputs: {
      invoicePostedTotalBase: toDb(invoicePosted, TOTAL_DP),
      paymentPostedTotalBase: toDb(paymentPosted, TOTAL_DP),
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
