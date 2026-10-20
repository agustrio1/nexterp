import { and, eq, gte, lte, or, sql } from "drizzle-orm";

import { bankStatementLines, cashTransactions } from "@/db/schema";
import { db } from "@/server/db";

/**
 * Util pencocokan rekonsiliasi bank (Tahap 4H-C). Menurunkan "perputaran kas"
 * sebuah rekening dari `cash_transactions` terposting, lengkap dengan arah
 * (`in`/`out`) relatif terhadap rekening tersebut, sehingga baris statement dapat
 * dicocokkan tanpa menyimpan kolom saldo.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Tx | typeof db;

export interface AccountMovement {
  cashTransactionId: string;
  date: string;
  amount: string;
  direction: "in" | "out";
  description: string;
}

/**
 * Perputaran kas `posted` untuk satu rekening dalam rentang tanggal (inklusif).
 * Arah diturunkan dari tipe transaksi terhadap rekening yang diminta:
 * - receipt (rekening asal)            -> in
 * - disbursement (rekening asal)       -> out
 * - transfer  (rekening asal)          -> out
 * - transfer  (rekening tujuan)        -> in
 */
export async function listAccountMovements(
  reader: Reader,
  bankAccountId: string,
  range?: { from: string; to: string },
): Promise<AccountMovement[]> {
  const conditions = [
    eq(cashTransactions.status, "posted"),
    or(
      eq(cashTransactions.bankAccountId, bankAccountId),
      eq(cashTransactions.counterpartBankAccountId, bankAccountId),
    ),
    range === undefined ? undefined : gte(cashTransactions.transactionDate, range.from),
    range === undefined ? undefined : lte(cashTransactions.transactionDate, range.to),
  ];

  const rows = await reader
    .select({
      id: cashTransactions.id,
      date: cashTransactions.transactionDate,
      amount: cashTransactions.amount,
      type: cashTransactions.type,
      bankAccountId: cashTransactions.bankAccountId,
      description: cashTransactions.description,
    })
    .from(cashTransactions)
    .where(and(...conditions));

  return rows.map((row) => {
    const isSource = row.bankAccountId === bankAccountId;
    // Transfer ke rekening ini (isSource false) atau penerimaan = uang masuk.
    const direction: "in" | "out" =
      row.type === "receipt" || (!isSource && row.type === "transfer") ? "in" : "out";
    return {
      cashTransactionId: row.id,
      date: row.date,
      amount: row.amount,
      direction,
      description: row.description,
    };
  });
}

/**
 * Id transaksi kas yang SUDAH dicocokkan baris statement. Bila `excludeReconciliationId`
 * diisi, pencocokan pada rekonsiliasi tersebut tidak dikecualikan (dipakai saat
 * mencocokkan ulang satu dokumen draft).
 */
export async function matchedCashTransactionIds(
  reader: Reader,
  excludeReconciliationId?: string,
): Promise<Set<string>> {
  const conditions = [
    sql`${bankStatementLines.matchedCashTransactionId} is not null`,
    excludeReconciliationId === undefined
      ? undefined
      : sql`(${bankStatementLines.reconciliationId} is null or ${bankStatementLines.reconciliationId} <> ${excludeReconciliationId})`,
  ];

  const rows = await reader
    .select({ id: bankStatementLines.matchedCashTransactionId })
    .from(bankStatementLines)
    .where(and(...conditions.filter((c): c is NonNullable<typeof c> => c !== undefined)));

  return new Set(rows.map((row) => row.id).filter((id): id is string => id !== null));
}

/** Transaksi kas `posted` yang tersedia (belum dicocokkan di mana pun) untuk pencocokan. */
export async function availableMovements(
  reader: Reader,
  bankAccountId: string,
  range: { from: string; to: string },
): Promise<AccountMovement[]> {
  const movements = await listAccountMovements(reader, bankAccountId, range);
  const taken = await matchedCashTransactionIds(reader);
  return movements.filter((movement) => !taken.has(movement.cashTransactionId));
}

/** Memastikan satu transaksi kas benar-benar `posted` & menyentuh rekening ini. */
export async function findMovementForAccount(
  reader: Reader,
  bankAccountId: string,
  cashTransactionId: string,
): Promise<AccountMovement | undefined> {
  const movements = await listAccountMovements(reader, bankAccountId);
  return movements.find((movement) => movement.cashTransactionId === cashTransactionId);
}

/** Kumpulan id baris yang sudah menunjuk transaksi tertentu (anti double-assign). */
export async function linesMatchingTransaction(
  reader: Reader,
  cashTransactionId: string,
  excludeLineId?: string,
): Promise<string[]> {
  const conditions = [
    eq(bankStatementLines.matchedCashTransactionId, cashTransactionId),
    excludeLineId === undefined ? undefined : sql`${bankStatementLines.id} <> ${excludeLineId}::uuid`,
  ];
  const rows = await reader
    .select({ id: bankStatementLines.id })
    .from(bankStatementLines)
    .where(and(...conditions.filter((c): c is NonNullable<typeof c> => c !== undefined)));
  return rows.map((row) => row.id);
}
