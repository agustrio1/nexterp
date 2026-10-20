import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import {
  accountingPeriods,
  branches,
  costCenters,
  journalEntries,
  taxTransactions,
  taxes,
} from "@/db/schema";
import { div, mul, round, toDb } from "@/lib/money";
import type {
  CreateTaxTransactionInput,
  ListTaxTransactionsQuery,
} from "@/modules/accounting/tax-cost-schemas";
import { resolveEffectiveRate } from "@/modules/accounting/tax-service";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { businessRule, forbidden, notFound, validationFailed } from "@/server/errors";
import { nextDocumentNumber } from "@/server/numbering";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const DEFAULT_LIST_LIMIT = 50;

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

async function inTx<T>(externalTx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (externalTx) return fn(externalTx);
  return db.transaction(fn);
}

const transactionColumns = {
  id: taxTransactions.id,
  docNo: taxTransactions.docNo,
  taxId: taxTransactions.taxId,
  taxCode: taxes.code,
  taxName: taxes.name,
  transactionDate: taxTransactions.transactionDate,
  periodId: taxTransactions.periodId,
  direction: taxTransactions.direction,
  baseAmount: taxTransactions.baseAmount,
  rate: taxTransactions.rate,
  taxAmount: taxTransactions.taxAmount,
  branchId: taxTransactions.branchId,
  costCenterId: taxTransactions.costCenterId,
  journalEntryId: taxTransactions.journalEntryId,
  notes: taxTransactions.notes,
  createdAt: taxTransactions.createdAt,
};

async function loadTransaction(reader: Tx | typeof db, id: string) {
  const [row] = await reader
    .select(transactionColumns)
    .from(taxTransactions)
    .innerJoin(taxes, eq(taxes.id, taxTransactions.taxId))
    .where(eq(taxTransactions.id, id))
    .limit(1);
  return row;
}

async function requireTransaction(reader: Tx | typeof db, id: string) {
  const row = await loadTransaction(reader, id);
  if (!row) throw notFound("Transaksi pajak tidak ditemukan.");
  return row;
}

/** Periode yang memuat tanggal (nullable; tanpa memandang status — subledger non-jurnal). */
async function resolvePeriod(tx: Tx, date: string): Promise<string | null> {
  const [period] = await tx
    .select({ id: accountingPeriods.id })
    .from(accountingPeriods)
    .where(
      and(lte(accountingPeriods.startDate, date), gte(accountingPeriods.endDate, date)),
    )
    .orderBy(sql`${accountingPeriods.startDate} desc`)
    .limit(1);
  return period?.id ?? null;
}

async function assertBranchActive(tx: Tx, branchId: string): Promise<void> {
  const [branch] = await tx
    .select({ id: branches.id, isActive: branches.isActive })
    .from(branches)
    .where(eq(branches.id, branchId))
    .limit(1);
  if (!branch) {
    throw validationFailed([{ path: "branchId", message: "Cabang tidak ditemukan." }]);
  }
  if (!branch.isActive) throw businessRule("Cabang tidak aktif.");
}

async function assertCostCenterActive(tx: Tx, costCenterId: string): Promise<void> {
  const [cc] = await tx
    .select({ id: costCenters.id, isActive: costCenters.isActive })
    .from(costCenters)
    .where(eq(costCenters.id, costCenterId))
    .limit(1);
  if (!cc) {
    throw validationFailed([{ path: "costCenterId", message: "Pusat biaya tidak ditemukan." }]);
  }
  if (!cc.isActive) throw businessRule("Pusat biaya tidak aktif.");
}

async function assertJournalExists(tx: Tx, journalId: string): Promise<void> {
  const [journal] = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(eq(journalEntries.id, journalId))
    .limit(1);
  if (!journal) {
    throw validationFailed([{ path: "journalEntryId", message: "Jurnal tidak ditemukan." }]);
  }
}

/* ------------------------------------------------------------------ */
/* Baca                                                                */
/* ------------------------------------------------------------------ */

export async function getTaxTransaction(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "accounting.tax_transactions.read");
  return requireTransaction(externalTx ?? db, id);
}

const cursorSchema = z.object({ d: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), i: z.uuid() });

function encodeCursor(date: string, id: string): string {
  return Buffer.from(JSON.stringify({ d: date, i: id }), "utf8").toString("base64url");
}

function decodeCursor(raw: string): { date: string; id: string } {
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    if (parsed.success) return { date: parsed.data.d, id: parsed.data.i };
  } catch {
    // fallthrough
  }
  throw validationFailed([{ path: "cursor", message: "Cursor tidak valid." }]);
}

export async function listTaxTransactions(
  actor: AuthContext,
  query: ListTaxTransactionsQuery = {},
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.tax_transactions.read");

  const limit = query.limit ?? DEFAULT_LIST_LIMIT;
  const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);

  const conditions: (SQL | undefined)[] = [
    query.taxId === undefined ? undefined : eq(taxTransactions.taxId, query.taxId),
    query.direction === undefined ? undefined : eq(taxTransactions.direction, query.direction),
    query.dateFrom === undefined ? undefined : gte(taxTransactions.transactionDate, query.dateFrom),
    query.dateTo === undefined ? undefined : lte(taxTransactions.transactionDate, query.dateTo),
    cursor === undefined
      ? undefined
      : sql`(${taxTransactions.transactionDate}, ${taxTransactions.id}) < (${cursor.date}::date, ${cursor.id}::uuid)`,
  ];

  const reader = externalTx ?? db;
  const rows = await reader
    .select(transactionColumns)
    .from(taxTransactions)
    .innerJoin(taxes, eq(taxes.id, taxTransactions.taxId))
    .where(and(...conditions))
    .orderBy(desc(taxTransactions.transactionDate), desc(taxTransactions.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page,
    nextCursor: hasMore && last ? encodeCursor(last.transactionDate, last.id) : null,
  };
}

/* ------------------------------------------------------------------ */
/* Tulis                                                               */
/* ------------------------------------------------------------------ */

export async function createTaxTransaction(
  actor: AuthContext,
  input: CreateTaxTransactionInput,
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.tax_transactions.manage");

  return inTx(externalTx, async (tx) => {
    const [tax] = await tx
      .select({ id: taxes.id, code: taxes.code, isActive: taxes.isActive })
      .from(taxes)
      .where(eq(taxes.id, input.taxId))
      .limit(1);
    if (!tax) throw notFound("Pajak tidak ditemukan.");
    if (!tax.isActive) throw businessRule(`Pajak ${tax.code} tidak aktif.`);

    const effective = await resolveEffectiveRate(tx, tax.id, input.transactionDate);
    if (!effective) {
      throw businessRule(
        `Belum ada tarif pajak ${tax.code} yang berlaku pada ${input.transactionDate}.`,
      );
    }

    if (input.branchId) await assertBranchActive(tx, input.branchId);
    if (input.costCenterId) await assertCostCenterActive(tx, input.costCenterId);
    if (input.journalEntryId) await assertJournalExists(tx, input.journalEntryId);

    // taxAmount = base * rate% (pembulatan HALF_UP 2dp via util uang).
    const taxAmount = toDb(round(mul(input.baseAmount, div(effective.rate, 100))));
    const baseAmount = toDb(input.baseAmount);
    const periodId = await resolvePeriod(tx, input.transactionDate);
    const docNo = await nextDocumentNumber(tx, "tax_transaction", {
      date: input.transactionDate,
    });

    const values = {
      docNo,
      taxId: tax.id,
      transactionDate: input.transactionDate,
      periodId,
      direction: input.direction,
      baseAmount,
      rate: effective.rate,
      taxAmount,
      branchId: input.branchId ?? null,
      costCenterId: input.costCenterId ?? null,
      journalEntryId: input.journalEntryId ?? null,
      notes: input.notes ?? null,
    };

    const [created] = await tx
      .insert(taxTransactions)
      .values({ ...values, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: taxTransactions.id });
    if (!created) throw new Error("Gagal mencatat transaksi pajak.");

    await audit.log(
      {
        action: "tax_transaction.create",
        entityType: "tax_transaction",
        entityId: created.id,
        actorId: actor.userId,
        after: values,
      },
      tx,
    );

    return requireTransaction(tx, created.id);
  });
}
