import { and, asc, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import {
  bankAccounts,
  bankReconciliations,
  bankStatementLines,
  cashTransactions,
} from "@/db/schema";
import { dec } from "@/lib/money";
import {
  findMovementForAccount,
  linesMatchingTransaction,
} from "@/modules/accounting/cash-movement";
import type {
  ImportBankStatementInput,
  ListBankStatementLinesQuery,
  SetStatementLineMatchInput,
} from "@/modules/accounting/reconciliation-schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { businessRule, conflict, forbidden, notFound, validationFailed } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Tx | typeof db;

const DEFAULT_LIST_LIMIT = 100;

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

async function inTx<T>(externalTx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (externalTx) return fn(externalTx);
  return db.transaction(fn);
}

const lineColumns = {
  id: bankStatementLines.id,
  bankAccountId: bankStatementLines.bankAccountId,
  bankAccountCode: bankAccounts.code,
  statementDate: bankStatementLines.statementDate,
  description: bankStatementLines.description,
  reference: bankStatementLines.reference,
  direction: bankStatementLines.direction,
  amount: bankStatementLines.amount,
  bookBalanceAfter: bankStatementLines.bookBalanceAfter,
  reconciliationId: bankStatementLines.reconciliationId,
  reconciliationDocNo: bankReconciliations.docNo,
  matchedCashTransactionId: bankStatementLines.matchedCashTransactionId,
  matchedCashTransactionDocNo: cashTransactions.docNo,
  createdAt: bankStatementLines.createdAt,
};

async function requireLine(reader: Reader, id: string) {
  const [row] = await reader
    .select(lineColumns)
    .from(bankStatementLines)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankStatementLines.bankAccountId))
    .leftJoin(bankReconciliations, eq(bankReconciliations.id, bankStatementLines.reconciliationId))
    .leftJoin(cashTransactions, eq(cashTransactions.id, bankStatementLines.matchedCashTransactionId))
    .where(eq(bankStatementLines.id, id))
    .limit(1);
  if (!row) throw notFound("Baris statement tidak ditemukan.");
  return row;
}

/** Rekening harus ada & aktif; mengembalikan barisnya. */
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

/* ------------------------------------------------------------------ */
/* Impor                                                               */
/* ------------------------------------------------------------------ */

export async function importBankStatement(
  actor: AuthContext,
  input: ImportBankStatementInput,
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.bank_reconciliations.manage");

  return inTx(externalTx, async (tx) => {
    await requireActiveBankAccount(tx, input.bankAccountId);

    const inserted = await tx
      .insert(bankStatementLines)
      .values(
        input.lines.map((line) => ({
          bankAccountId: input.bankAccountId,
          statementDate: line.statementDate,
          description: line.description,
          reference: line.reference ?? null,
          direction: line.direction,
          amount: line.amount,
          bookBalanceAfter: line.bookBalanceAfter ?? null,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        })),
      )
      .returning({ id: bankStatementLines.id });

    await audit.log(
      {
        action: "bank_statement.import",
        entityType: "bank_account",
        entityId: input.bankAccountId,
        actorId: actor.userId,
        after: { imported: inserted.length },
      },
      tx,
    );

    return { imported: inserted.length };
  });
}

/* ------------------------------------------------------------------ */
/* Baca                                                                */
/* ------------------------------------------------------------------ */

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

export async function listBankStatementLines(
  actor: AuthContext,
  query: ListBankStatementLinesQuery = {},
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.bank_reconciliations.read");

  const limit = query.limit ?? DEFAULT_LIST_LIMIT;
  const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);

  const conditions: (SQL | undefined)[] = [
    query.bankAccountId === undefined
      ? undefined
      : eq(bankStatementLines.bankAccountId, query.bankAccountId),
    query.reconciliationId === undefined
      ? undefined
      : eq(bankStatementLines.reconciliationId, query.reconciliationId),
    query.matched === undefined
      ? undefined
      : query.matched
        ? sql`${bankStatementLines.matchedCashTransactionId} is not null`
        : sql`${bankStatementLines.matchedCashTransactionId} is null`,
    query.dateFrom === undefined ? undefined : gte(bankStatementLines.statementDate, query.dateFrom),
    query.dateTo === undefined ? undefined : lte(bankStatementLines.statementDate, query.dateTo),
    cursor === undefined
      ? undefined
      : sql`(${bankStatementLines.statementDate}, ${bankStatementLines.id}) < (${cursor.date}::date, ${cursor.id}::uuid)`,
  ];

  const reader = externalTx ?? db;
  const rows = await reader
    .select(lineColumns)
    .from(bankStatementLines)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankStatementLines.bankAccountId))
    .leftJoin(bankReconciliations, eq(bankReconciliations.id, bankStatementLines.reconciliationId))
    .leftJoin(cashTransactions, eq(cashTransactions.id, bankStatementLines.matchedCashTransactionId))
    .where(and(...conditions))
    .orderBy(desc(bankStatementLines.statementDate), desc(bankStatementLines.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page,
    nextCursor: hasMore && last ? encodeCursor(last.statementDate, last.id) : null,
  };
}

export async function getBankStatementLine(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "accounting.bank_reconciliations.read");
  return requireLine(externalTx ?? db, id);
}

/* ------------------------------------------------------------------ */
/* Pencocokan manual satu baris                                        */
/* ------------------------------------------------------------------ */

export async function setStatementLineMatch(
  actor: AuthContext,
  lineId: string,
  input: SetStatementLineMatchInput,
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.bank_reconciliations.manage");

  return inTx(externalTx, async (tx) => {
    const [line] = await tx
      .select({
        id: bankStatementLines.id,
        bankAccountId: bankStatementLines.bankAccountId,
        direction: bankStatementLines.direction,
        amount: bankStatementLines.amount,
        reconciliationId: bankStatementLines.reconciliationId,
        reconciliationStatus: bankReconciliations.status,
      })
      .from(bankStatementLines)
      .leftJoin(bankReconciliations, eq(bankReconciliations.id, bankStatementLines.reconciliationId))
      .where(eq(bankStatementLines.id, lineId))
      .for("update", { of: bankStatementLines })
      .limit(1);
    if (!line) throw notFound("Baris statement tidak ditemukan.");
    if (line.reconciliationStatus === "final") {
      throw businessRule("Baris pada rekonsiliasi final tidak dapat diubah.");
    }

    // Buka pencocokan.
    if (input.cashTransactionId === null) {
      await tx
        .update(bankStatementLines)
        .set({ matchedCashTransactionId: null, updatedBy: actor.userId, updatedAt: new Date() })
        .where(eq(bankStatementLines.id, lineId));
      await audit.log(
        {
          action: "bank_statement_line.unmatch",
          entityType: "bank_statement_line",
          entityId: lineId,
          actorId: actor.userId,
        },
        tx,
      );
      return requireLine(tx, lineId);
    }

    // Cocokkan manual: transaksi harus posted & menyentuh rekening, arah & nominal sama.
    const movement = await findMovementForAccount(tx, line.bankAccountId, input.cashTransactionId);
    if (!movement) {
      throw validationFailed([
        { path: "cashTransactionId", message: "Transaksi kas posted tidak ditemukan untuk rekening ini." },
      ]);
    }
    if (movement.direction !== line.direction || !dec(movement.amount).equals(dec(line.amount))) {
      throw businessRule("Transaksi kas tidak cocok dengan arah atau nominal baris statement ini.");
    }
    const already = await linesMatchingTransaction(tx, input.cashTransactionId, lineId);
    if (already.length > 0) {
      throw conflict("Transaksi kas ini sudah dicocokkan ke baris statement lain.");
    }

    await tx
      .update(bankStatementLines)
      .set({
        matchedCashTransactionId: input.cashTransactionId,
        updatedBy: actor.userId,
        updatedAt: new Date(),
      })
      .where(eq(bankStatementLines.id, lineId));

    await audit.log(
      {
        action: "bank_statement_line.match",
        entityType: "bank_statement_line",
        entityId: lineId,
        actorId: actor.userId,
        after: { cashTransactionId: input.cashTransactionId },
      },
      tx,
    );

    return requireLine(tx, lineId);
  });
}

/** Daftar baris dalam suatu dokumen rekonsiliasi (untuk service rekonsiliasi). */
export async function listLinesOfReconciliation(reader: Reader, reconciliationId: string) {
  return reader
    .select(lineColumns)
    .from(bankStatementLines)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankStatementLines.bankAccountId))
    .leftJoin(bankReconciliations, eq(bankReconciliations.id, bankStatementLines.reconciliationId))
    .leftJoin(cashTransactions, eq(cashTransactions.id, bankStatementLines.matchedCashTransactionId))
    .where(eq(bankStatementLines.reconciliationId, reconciliationId))
    .orderBy(asc(bankStatementLines.statementDate), asc(bankStatementLines.id));
}
