import { and, asc, desc, eq, gte, inArray, isNull, lte, lt, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import {
  bankAccounts,
  bankReconciliations,
  bankStatementLines,
  chartAccounts,
  journalEntries,
  journalEntryLines,
} from "@/db/schema";
import { dec, toDb } from "@/lib/money";
import {
  listAccountMovements,
  matchedCashTransactionIds,
  type AccountMovement,
} from "@/modules/accounting/cash-movement";
import {
  listLinesOfReconciliation,
} from "@/modules/accounting/bank-statement-service";
import type {
  CreateBankReconciliationInput,
  ListBankReconciliationsQuery,
} from "@/modules/accounting/reconciliation-schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { businessRule, forbidden, notFound, validationFailed } from "@/server/errors";
import { nextDocumentNumber } from "@/server/numbering";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Tx | typeof db;

const LEDGER_STATUSES = ["posted", "reversed"] as const;
const DEFAULT_LIST_LIMIT = 50;
const DEFAULT_TOLERANCE_DAYS = 3;

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

async function inTx<T>(externalTx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (externalTx) return fn(externalTx);
  return db.transaction(fn);
}

const reconciliationColumns = {
  id: bankReconciliations.id,
  docNo: bankReconciliations.docNo,
  bankAccountId: bankReconciliations.bankAccountId,
  bankAccountCode: bankAccounts.code,
  bankAccountName: bankAccounts.name,
  startDate: bankReconciliations.startDate,
  endDate: bankReconciliations.endDate,
  statementOpeningBalance: bankReconciliations.statementOpeningBalance,
  statementClosingBalance: bankReconciliations.statementClosingBalance,
  bookBalanceStart: bankReconciliations.bookBalanceStart,
  bookBalanceEnd: bankReconciliations.bookBalanceEnd,
  status: bankReconciliations.status,
  notes: bankReconciliations.notes,
  finalizedAt: bankReconciliations.finalizedAt,
  finalizedBy: bankReconciliations.finalizedBy,
  createdAt: bankReconciliations.createdAt,
  updatedAt: bankReconciliations.updatedAt,
};

async function requireReconciliation(reader: Reader, id: string) {
  const [row] = await reader
    .select(reconciliationColumns)
    .from(bankReconciliations)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankReconciliations.bankAccountId))
    .where(eq(bankReconciliations.id, id))
    .limit(1);
  if (!row) throw notFound("Rekonsiliasi bank tidak ditemukan.");
  return row;
}

async function lockReconciliation(tx: Tx, id: string) {
  const [row] = await tx
    .select({
      id: bankReconciliations.id,
      bankAccountId: bankReconciliations.bankAccountId,
      startDate: bankReconciliations.startDate,
      endDate: bankReconciliations.endDate,
      statementClosingBalance: bankReconciliations.statementClosingBalance,
      docNo: bankReconciliations.docNo,
      status: bankReconciliations.status,
    })
    .from(bankReconciliations)
    .where(eq(bankReconciliations.id, id))
    .for("update")
    .limit(1);
  if (!row) throw notFound("Rekonsiliasi bank tidak ditemukan.");
  return row;
}

async function requireActiveBankAccount(tx: Tx, id: string) {
  const [account] = await tx
    .select({ id: bankAccounts.id, code: bankAccounts.code, isActive: bankAccounts.isActive })
    .from(bankAccounts)
    .where(eq(bankAccounts.id, id))
    .limit(1);
  if (!account) throw validationFailed([{ path: "bankAccountId", message: "Rekening kas/bank tidak ditemukan." }]);
  if (!account.isActive) throw businessRule(`Rekening ${account.code} tidak aktif.`);
  return account;
}

/**
 * Saldo buku (GL) satu akun kas pada satu titik waktu. Arah normal menentukan
 * tanda: akun aset/bebannya debit-min-kredit, selainnya kredit-min-debit.
 * `condition` menyaring tanggal pembukuan (mis. `< startDate` atau `<= endDate`).
 */
async function glBalance(
  reader: Reader,
  glAccountId: string,
  condition: SQL,
): Promise<string> {
  const [row] = await reader
    .select({
      value: sql<string>`coalesce(sum(case when ${chartAccounts.type} in ('asset', 'expense')
          then ${journalEntryLines.debit} - ${journalEntryLines.credit}
          else ${journalEntryLines.credit} - ${journalEntryLines.debit}
        end), 0)::text`,
    })
    .from(journalEntryLines)
    .innerJoin(
      journalEntries,
      and(
        eq(journalEntries.id, journalEntryLines.entryId),
        inArray(journalEntries.status, [...LEDGER_STATUSES]),
      ),
    )
    .innerJoin(chartAccounts, eq(chartAccounts.id, journalEntryLines.accountId))
    .where(and(eq(journalEntryLines.accountId, glAccountId), condition));
  return row?.value ?? "0.00";
}

async function fetchGlAccountId(reader: Reader, bankAccountId: string): Promise<string | null> {
  const [account] = await reader
    .select({ glAccountId: bankAccounts.accountId })
    .from(bankAccounts)
    .where(eq(bankAccounts.id, bankAccountId))
    .limit(1);
  return account?.glAccountId ?? null;
}

/* ------------------------------------------------------------------ */
/* Auto-match internal                                                 */
/* ------------------------------------------------------------------ */

function dayDiff(a: string, b: string): number {
  const ms = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return Math.round(ms / 86_400_000);
}

async function runAutoMatch(
  tx: Tx,
  actor: AuthContext,
  reconciliation: { id: string; bankAccountId: string; startDate: string; endDate: string },
  toleranceDays: number,
): Promise<number> {
  // Baris milik dokumen ini yang belum tercocokkan.
  const allLines = await tx
    .select({
      id: bankStatementLines.id,
      statementDate: bankStatementLines.statementDate,
      direction: bankStatementLines.direction,
      amount: bankStatementLines.amount,
      matchedCashTransactionId: bankStatementLines.matchedCashTransactionId,
    })
    .from(bankStatementLines)
    .where(eq(bankStatementLines.reconciliationId, reconciliation.id))
    .orderBy(asc(bankStatementLines.statementDate), asc(bankStatementLines.id));

  const unmatched = allLines.filter((line) => line.matchedCashTransactionId === null);
  if (unmatched.length === 0) return 0;

  // Kandidat: transaksi posted pada rekening & rentang, belum dicocokkan di mana pun.
  const movements = await listAccountMovements(tx, reconciliation.bankAccountId, {
    from: reconciliation.startDate,
    to: reconciliation.endDate,
  });
  const taken = await matchedCashTransactionIds(tx);
  const pool: AccountMovement[] = movements.filter((m) => !taken.has(m.cashTransactionId));

  const used = new Set<string>();
  let matchedCount = 0;

  for (const line of unmatched) {
    let best: AccountMovement | undefined;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (const movement of pool) {
      if (used.has(movement.cashTransactionId)) continue;
      if (movement.direction !== line.direction) continue;
      if (!dec(movement.amount).equals(dec(line.amount))) continue;
      const diff = dayDiff(movement.date, line.statementDate);
      if (diff > toleranceDays) continue;
      if (diff < bestDiff) {
        best = movement;
        bestDiff = diff;
      }
    }
    if (best) {
      used.add(best.cashTransactionId);
      await tx
        .update(bankStatementLines)
        .set({
          matchedCashTransactionId: best.cashTransactionId,
          updatedBy: actor.userId,
          updatedAt: new Date(),
        })
        .where(eq(bankStatementLines.id, line.id));
      matchedCount += 1;
    }
  }

  return matchedCount;
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

export async function createBankReconciliation(
  actor: AuthContext,
  input: CreateBankReconciliationInput,
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.bank_reconciliations.manage");

  return inTx(externalTx, async (tx) => {
    await requireActiveBankAccount(tx, input.bankAccountId);

    const [header] = await tx
      .insert(bankReconciliations)
      .values({
        bankAccountId: input.bankAccountId,
        startDate: input.startDate,
        endDate: input.endDate,
        statementOpeningBalance: input.statementOpeningBalance,
        statementClosingBalance: input.statementClosingBalance,
        notes: input.notes ?? null,
        status: "draft",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: bankReconciliations.id });

    const id = header!.id;

    // Tarik baris statement milik rekening pada rentang ini yang belum punya dokumen.
    const pulled = await tx
      .update(bankStatementLines)
      .set({ reconciliationId: id, updatedBy: actor.userId, updatedAt: new Date() })
      .where(
        and(
          eq(bankStatementLines.bankAccountId, input.bankAccountId),
          isNull(bankStatementLines.reconciliationId),
          gte(bankStatementLines.statementDate, input.startDate),
          lte(bankStatementLines.statementDate, input.endDate),
        ),
      )
      .returning({ id: bankStatementLines.id });

    let autoMatched = 0;
    if (input.autoMatch && pulled.length > 0) {
      autoMatched = await runAutoMatch(
        tx,
        actor,
        {
          id,
          bankAccountId: input.bankAccountId,
          startDate: input.startDate,
          endDate: input.endDate,
        },
        input.toleranceDays ?? DEFAULT_TOLERANCE_DAYS,
      );
    }

    await audit.log(
      {
        action: "bank_reconciliation.create",
        entityType: "bank_reconciliation",
        entityId: id,
        actorId: actor.userId,
        after: { pulled: pulled.length, autoMatched },
      },
      tx,
    );

    const detail = await getReconciliation(actor, id, tx);
    return { ...detail, pulled: pulled.length, autoMatched };
  });
}

/* ------------------------------------------------------------------ */
/* Baca                                                                */
/* ------------------------------------------------------------------ */

const cursorSchema = z.object({ t: z.number().int().nonnegative(), i: z.uuid() });

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ t: createdAt.getTime(), i: id }), "utf8").toString("base64url");
}

function decodeCursor(raw: string): { createdAt: Date; id: string } {
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    if (parsed.success) return { createdAt: new Date(parsed.data.t), id: parsed.data.i };
  } catch {
    // fallthrough
  }
  throw validationFailed([{ path: "cursor", message: "Cursor tidak valid." }]);
}

export async function listBankReconciliations(
  actor: AuthContext,
  query: ListBankReconciliationsQuery = {},
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.bank_reconciliations.read");

  const limit = query.limit ?? DEFAULT_LIST_LIMIT;
  const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);

  const conditions: (SQL | undefined)[] = [
    query.bankAccountId === undefined
      ? undefined
      : eq(bankReconciliations.bankAccountId, query.bankAccountId),
    query.status === undefined ? undefined : eq(bankReconciliations.status, query.status),
    query.dateFrom === undefined ? undefined : gte(bankReconciliations.endDate, query.dateFrom),
    query.dateTo === undefined ? undefined : lte(bankReconciliations.startDate, query.dateTo),
    cursor === undefined
      ? undefined
      : sql`(${bankReconciliations.createdAt}, ${bankReconciliations.id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
  ];

  const reader = externalTx ?? db;
  const rows = await reader
    .select(reconciliationColumns)
    .from(bankReconciliations)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankReconciliations.bankAccountId))
    .where(and(...conditions))
    .orderBy(desc(bankReconciliations.createdAt), desc(bankReconciliations.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page,
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

export async function getReconciliation(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "accounting.bank_reconciliations.read");

  const reader = externalTx ?? db;
  const header = await requireReconciliation(reader, id);
  const lines = await listLinesOfReconciliation(reader, id);

  const matched = lines.filter((line) => line.matchedCashTransactionId !== null).length;

  // Ringkasan numerik (desimal) untuk membantu UI; tidak mempersistensi apa pun.
  let netStatement = dec(0);
  for (const line of lines) {
    netStatement = line.direction === "in" ? netStatement.add(line.amount) : netStatement.sub(line.amount);
  }

  return {
    ...header,
    summary: {
      totalLines: lines.length,
      matchedLines: matched,
      unmatchedLines: lines.length - matched,
      netStatementMovement: toDb(netStatement),
    },
    lines,
  };
}

/* ------------------------------------------------------------------ */
/* Auto-match endpoint                                                 */
/* ------------------------------------------------------------------ */

export async function autoMatchReconciliation(
  actor: AuthContext,
  id: string,
  toleranceDays: number,
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.bank_reconciliations.manage");

  return inTx(externalTx, async (tx) => {
    const recon = await lockReconciliation(tx, id);
    if (recon.status !== "draft") throw businessRule("Hanya rekonsiliasi berstatus draft yang dapat dicocokkan ulang.");

    const matchedCount = await runAutoMatch(tx, actor, recon, toleranceDays);

    await audit.log(
      {
        action: "bank_reconciliation.auto_match",
        entityType: "bank_reconciliation",
        entityId: id,
        actorId: actor.userId,
        after: { matchedCount, toleranceDays },
      },
      tx,
    );

    return { matchedCount };
  });
}

/* ------------------------------------------------------------------ */
/* Finalize                                                            */
/* ------------------------------------------------------------------ */

export async function finalizeBankReconciliation(
  actor: AuthContext,
  id: string,
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.bank_reconciliations.manage");

  return inTx(externalTx, async (tx) => {
    const recon = await lockReconciliation(tx, id);
    if (recon.status !== "draft") throw businessRule("Hanya rekonsiliasi berstatus draft yang dapat difinalkan.");

    // 1) Semua baris harus sudah tercocokkan.
    const [unmatched] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(bankStatementLines)
      .where(
        and(
          eq(bankStatementLines.reconciliationId, id),
          isNull(bankStatementLines.matchedCashTransactionId),
        ),
      );
    const unmatchedCount = unmatched?.count ?? 0;
    if (unmatchedCount > 0) {
      throw businessRule(`${unmatchedCount} baris statement belum dicocokkan; selesaikan pencocokan sebelum finalisasi.`);
    }

    // 2) Snapshot saldo buku (GL) dari akun kas rekening.
    const glAcct = await fetchGlAccountId(tx, recon.bankAccountId);
    if (glAcct === null) {
      throw businessRule("Rekening tidak memiliki akun GL kas untuk menghitung saldo buku.");
    }
    const bookBalanceStart = await glBalance(tx, glAcct, lt(journalEntries.entryDate, recon.startDate));
    const bookBalanceEnd = await glBalance(tx, glAcct, lte(journalEntries.entryDate, recon.endDate));

    // 3) Invarian: saldo akhir statement == saldo buku pada akhir rentang.
    const difference = dec(recon.statementClosingBalance).sub(bookBalanceEnd);
    if (!difference.isZero()) {
      throw businessRule(
        `Rekonsiliasi tidak seimbang: selisih ${toDb(difference)} antara saldo statement dan buku.`,
      );
    }

    const docNo = await nextDocumentNumber(tx, "bank_reconciliation", { date: recon.startDate });

    await tx
      .update(bankReconciliations)
      .set({
        status: "final",
        docNo,
        bookBalanceStart,
        bookBalanceEnd,
        finalizedAt: new Date(),
        finalizedBy: actor.userId,
        updatedBy: actor.userId,
        updatedAt: new Date(),
      })
      .where(eq(bankReconciliations.id, id));

    await audit.log(
      {
        action: "bank_reconciliation.finalize",
        entityType: "bank_reconciliation",
        entityId: id,
        actorId: actor.userId,
        before: { status: recon.status, docNo: recon.docNo ?? null },
        after: { status: "final", docNo, bookBalanceStart, bookBalanceEnd },
      },
      tx,
    );

    return getReconciliation(actor, id, tx);
  });
}
