import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import {
  bankAccounts,
  branches,
  cashTransactions,
  chartAccounts,
  costCenters,
  journalEntries,
} from "@/db/schema";
import { toDb } from "@/lib/money";
import type {
  CancelCashTransactionInput,
  CreateCashTransactionInput,
  ListCashTransactionsQuery,
  ReverseCashTransactionInput,
} from "@/modules/accounting/cash-schemas";
import {
  createSystemDraft,
  postJournal,
  reverseJournal,
} from "@/modules/accounting/journal-service";
import type { JournalLineInput } from "@/modules/accounting/schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { businessRule, conflict, forbidden, notFound, validationFailed } from "@/server/errors";
import { nextDocumentNumber } from "@/server/numbering";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const DEFAULT_LIST_LIMIT = 50;
const SOURCE_CASH = "cash_transaction";

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

async function inTx<T>(externalTx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (externalTx) return fn(externalTx);
  return db.transaction(fn);
}

// Alias agar tiga relasi ke bank_accounts/chart_accounts tidak saling bertabrakan.
const bankPrimary = alias(bankAccounts, "bank_primary");
const bankCounterpart = alias(bankAccounts, "bank_counterpart");

const transactionColumns = {
  id: cashTransactions.id,
  docNo: cashTransactions.docNo,
  transactionDate: cashTransactions.transactionDate,
  type: cashTransactions.type,
  status: cashTransactions.status,
  bankAccountId: cashTransactions.bankAccountId,
  bankAccountCode: bankPrimary.code,
  bankAccountName: bankPrimary.name,
  contraAccountId: cashTransactions.contraAccountId,
  contraAccountCode: chartAccounts.code,
  contraAccountName: chartAccounts.name,
  counterpartBankAccountId: cashTransactions.counterpartBankAccountId,
  counterpartCode: bankCounterpart.code,
  counterpartName: bankCounterpart.name,
  amount: cashTransactions.amount,
  branchId: cashTransactions.branchId,
  costCenterId: cashTransactions.costCenterId,
  journalEntryId: cashTransactions.journalEntryId,
  description: cashTransactions.description,
  reference: cashTransactions.reference,
  reason: cashTransactions.reason,
  createdAt: cashTransactions.createdAt,
  updatedAt: cashTransactions.updatedAt,
};

async function readTransaction(reader: Tx | typeof db, id: string) {
  const [row] = await reader
    .select(transactionColumns)
    .from(cashTransactions)
    .leftJoin(bankPrimary, eq(bankPrimary.id, cashTransactions.bankAccountId))
    .leftJoin(bankCounterpart, eq(bankCounterpart.id, cashTransactions.counterpartBankAccountId))
    .leftJoin(chartAccounts, eq(chartAccounts.id, cashTransactions.contraAccountId))
    .where(eq(cashTransactions.id, id))
    .limit(1);
  return row;
}

async function requireTransaction(reader: Tx | typeof db, id: string) {
  const row = await readTransaction(reader, id);
  if (!row) throw notFound("Transaksi kas/bank tidak ditemukan.");
  return row;
}

async function lockTransaction(tx: Tx, id: string) {
  const [row] = await tx
    .select({ id: cashTransactions.id, status: cashTransactions.status })
    .from(cashTransactions)
    .where(eq(cashTransactions.id, id))
    .for("update")
    .limit(1);
  if (!row) throw notFound("Transaksi kas/bank tidak ditemukan.");
  return row;
}

/** Rekening kas/bank harus ada & aktif; mengembalikan id akun GL-nya. */
async function requireActiveBankAccount(tx: Tx, id: string, path: string): Promise<string> {
  const [account] = await tx
    .select({
      id: bankAccounts.id,
      code: bankAccounts.code,
      isActive: bankAccounts.isActive,
      accountId: bankAccounts.accountId,
    })
    .from(bankAccounts)
    .where(eq(bankAccounts.id, id))
    .limit(1);
  if (!account) throw validationFailed([{ path, message: "Rekening kas/bank tidak ditemukan." }]);
  if (!account.isActive) throw businessRule(`Rekening ${account.code} tidak aktif.`);
  return account.accountId;
}

/** Akun GL lawan harus ada, aktif, dan postable. */
async function requirePostableAccount(tx: Tx, id: string, path: string): Promise<void> {
  const [account] = await tx
    .select({
      id: chartAccounts.id,
      code: chartAccounts.code,
      isActive: chartAccounts.isActive,
      isPostable: chartAccounts.isPostable,
    })
    .from(chartAccounts)
    .where(eq(chartAccounts.id, id))
    .limit(1);
  if (!account) throw validationFailed([{ path, message: "Akun GL tidak ditemukan." }]);
  if (!account.isActive) throw businessRule(`Akun GL ${account.code} tidak aktif.`);
  if (!account.isPostable) {
    throw businessRule(`Akun GL ${account.code} bukan akun postable (induk pohon).`);
  }
}

async function assertBranchActive(tx: Tx, branchId: string): Promise<void> {
  const [branch] = await tx
    .select({ id: branches.id, isActive: branches.isActive })
    .from(branches)
    .where(eq(branches.id, branchId))
    .limit(1);
  if (!branch) throw validationFailed([{ path: "branchId", message: "Cabang tidak ditemukan." }]);
  if (!branch.isActive) throw businessRule("Cabang tidak aktif.");
}

async function assertCostCenterActive(tx: Tx, costCenterId: string): Promise<void> {
  const [cc] = await tx
    .select({ id: costCenters.id, isActive: costCenters.isActive })
    .from(costCenters)
    .where(eq(costCenters.id, costCenterId))
    .limit(1);
  if (!cc) throw validationFailed([{ path: "costCenterId", message: "Pusat biaya tidak ditemukan." }]);
  if (!cc.isActive) throw businessRule("Pusat biaya tidak aktif.");
}

/** Menyelesaikan referensi transaksi dan mengembalikan GL account sisi kas. */
async function resolveAccounts(
  tx: Tx,
  input: CreateCashTransactionInput,
): Promise<{ cashGlAccountId: string }> {
  const cashGlAccountId = await requireActiveBankAccount(tx, input.bankAccountId, "bankAccountId");

  if (input.type === "transfer") {
    if (!input.counterpartBankAccountId) {
      throw validationFailed([
        { path: "counterpartBankAccountId", message: "Transfer membutuhkan rekening tujuan." },
      ]);
    }
    await requireActiveBankAccount(tx, input.counterpartBankAccountId, "counterpartBankAccountId");
  } else {
    if (!input.contraAccountId) {
      throw validationFailed([
        { path: "contraAccountId", message: "Penerimaan/pengeluaran membutuhkan akun lawan." },
      ]);
    }
    await requirePostableAccount(tx, input.contraAccountId, "contraAccountId");
  }

  if (input.branchId) await assertBranchActive(tx, input.branchId);
  if (input.costCenterId) await assertCostCenterActive(tx, input.costCenterId);

  return { cashGlAccountId };
}

/** Menyusun baris jurnal double-entry dari transaksi kas (satu arah debit/kredit). */
function buildJournalLines(
  txn: {
    type: "receipt" | "disbursement" | "transfer";
    amount: string;
    contraAccountId: string | null;
    branchId: string | null;
    costCenterId: string | null;
  },
  cashGlAccountId: string,
  counterpartGlAccountId: string | null,
): JournalLineInput[] {
  const amount = toDb(txn.amount);
  const kasLine = { branchId: txn.branchId ?? null };
  const contraLine = { branchId: txn.branchId ?? null, costCenterId: txn.costCenterId ?? null };

  if (txn.type === "transfer") {
    // Dr rekening tujuan, Cr rekening asal. Tidak memakai pusat biaya.
    return [
      { accountId: counterpartGlAccountId as string, side: "debit", amount },
      { accountId: cashGlAccountId, side: "credit", amount },
    ];
  }

  const contraAccountId = txn.contraAccountId as string;
  if (txn.type === "receipt") {
    // Dr kas/bank, Cr akun lawan (mis. pendapatan/piutang).
    return [
      { accountId: cashGlAccountId, side: "debit", amount, ...kasLine },
      { accountId: contraAccountId, side: "credit", amount, ...contraLine },
    ];
  }
  // disbursement: Dr akun lawan (mis. beban), Cr kas/bank.
  return [
    { accountId: contraAccountId, side: "debit", amount, ...contraLine },
    { accountId: cashGlAccountId, side: "credit", amount, ...kasLine },
  ];
}

/* ------------------------------------------------------------------ */
/* Baca                                                                */
/* ------------------------------------------------------------------ */

export async function getCashTransaction(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "accounting.cash_transactions.read");
  return requireTransaction(externalTx ?? db, id);
}

const cursorSchema = z.object({ d: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), i: z.uuid() });

function encodeCursor(date: string, id: string): string {
  return Buffer.from(JSON.stringify({ d: date, i: id }), "utf8").toString("base64url");
}

function decodeCursor(raw: string): { date: string; id: string } {
  try {
    const parsed = cursorSchema.safeParse(
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8")),
    );
    if (parsed.success) return { date: parsed.data.d, id: parsed.data.i };
  } catch {
    // fallthrough
  }
  throw validationFailed([{ path: "cursor", message: "Cursor tidak valid." }]);
}

export async function listCashTransactions(
  actor: AuthContext,
  query: ListCashTransactionsQuery = {},
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.cash_transactions.read");

  const limit = query.limit ?? DEFAULT_LIST_LIMIT;
  const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);

  const conditions: (SQL | undefined)[] = [
    query.bankAccountId === undefined
      ? undefined
      : eq(cashTransactions.bankAccountId, query.bankAccountId),
    query.type === undefined ? undefined : eq(cashTransactions.type, query.type),
    query.status === undefined ? undefined : eq(cashTransactions.status, query.status),
    query.dateFrom === undefined
      ? undefined
      : gte(cashTransactions.transactionDate, query.dateFrom),
    query.dateTo === undefined ? undefined : lte(cashTransactions.transactionDate, query.dateTo),
    cursor === undefined
      ? undefined
      : sql`(${cashTransactions.transactionDate}, ${cashTransactions.id}) < (${cursor.date}::date, ${cursor.id}::uuid)`,
  ];

  const reader = externalTx ?? db;
  const rows = await reader
    .select(transactionColumns)
    .from(cashTransactions)
    .leftJoin(bankPrimary, eq(bankPrimary.id, cashTransactions.bankAccountId))
    .leftJoin(bankCounterpart, eq(bankCounterpart.id, cashTransactions.counterpartBankAccountId))
    .leftJoin(chartAccounts, eq(chartAccounts.id, cashTransactions.contraAccountId))
    .where(and(...conditions))
    .orderBy(desc(cashTransactions.transactionDate), desc(cashTransactions.id))
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

export async function createCashTransactionDraft(
  actor: AuthContext,
  input: CreateCashTransactionInput,
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.cash_transactions.manage");

  return inTx(externalTx, async (tx) => {
    if (input.idempotencyKey) {
      const [existing] = await tx
        .select({ id: cashTransactions.id })
        .from(cashTransactions)
        .where(eq(cashTransactions.reference, input.idempotencyKey))
        .limit(1);
      if (existing) throw conflict("idempotencyKey sudah dipakai untuk transaksi lain.");
    }

    await resolveAccounts(tx, input);

    const values = {
      transactionDate: input.transactionDate,
      type: input.type,
      bankAccountId: input.bankAccountId,
      contraAccountId: input.contraAccountId ?? null,
      counterpartBankAccountId: input.counterpartBankAccountId ?? null,
      amount: toDb(input.amount),
      branchId: input.branchId ?? null,
      costCenterId: input.costCenterId ?? null,
      description: input.description,
      reference: input.reference ?? null,
    };

    const [created] = await tx
      .insert(cashTransactions)
      .values({
        ...values,
        status: "draft",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: cashTransactions.id });
    if (!created) throw new Error("Gagal membuat draf transaksi kas/bank.");

    await audit.log(
      {
        action: "cash_transaction.create",
        entityType: "cash_transaction",
        entityId: created.id,
        actorId: actor.userId,
        after: values,
      },
      tx,
    );

    return requireTransaction(tx, created.id);
  });
}

export async function postCashTransaction(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "accounting.cash_transactions.manage");

  return inTx(externalTx, async (tx) => {
    const locked = await lockTransaction(tx, id);
    if (locked.status !== "draft") {
      throw businessRule("Hanya transaksi berstatus draft yang dapat diposting.");
    }

    const draft = await requireTransaction(tx, id);

    // Selesaikan ulang referensi pada saat posting (fail closed bila berubah).
    const cashGlAccountId = await requireActiveBankAccount(
      tx,
      draft.bankAccountId,
      "bankAccountId",
    );
    let counterpartGlAccountId: string | null = null;
    if (draft.type === "transfer") {
      counterpartGlAccountId = await requireActiveBankAccount(
        tx,
        draft.counterpartBankAccountId as string,
        "counterpartBankAccountId",
      );
    } else {
      await requirePostableAccount(tx, draft.contraAccountId as string, "contraAccountId");
    }

    const lines = buildJournalLines(draft, cashGlAccountId, counterpartGlAccountId);

    const systemDraft = await createSystemDraft(tx, actor, {
      entryDate: draft.transactionDate,
      description: draft.description,
      reference: draft.reference,
      lines,
      sourceType: SOURCE_CASH,
      sourceId: draft.id,
      sourceEvent: "post",
    });

    const posted = await postJournal(actor, systemDraft.id, tx);

    const docNo = await nextDocumentNumber(tx, "cash_transaction", {
      date: draft.transactionDate,
      branchId: draft.branchId ?? undefined,
    });

    await tx
      .update(cashTransactions)
      .set({
        status: "posted",
        docNo,
        journalEntryId: posted.id,
        updatedBy: actor.userId,
        updatedAt: new Date(),
      })
      .where(eq(cashTransactions.id, id));

    await audit.log(
      {
        action: "cash_transaction.post",
        entityType: "cash_transaction",
        entityId: id,
        actorId: actor.userId,
        before: { status: "draft" },
        after: { status: "posted", docNo, journalEntryId: posted.id },
      },
      tx,
    );

    return requireTransaction(tx, id);
  });
}

export async function cancelCashTransaction(
  actor: AuthContext,
  id: string,
  input: CancelCashTransactionInput,
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.cash_transactions.manage");

  return inTx(externalTx, async (tx) => {
    const locked = await lockTransaction(tx, id);
    if (locked.status !== "draft") {
      throw businessRule("Hanya transaksi berstatus draft yang dapat dibatalkan.");
    }

    await tx
      .update(cashTransactions)
      .set({
        status: "cancelled",
        reason: input.reason,
        updatedBy: actor.userId,
        updatedAt: new Date(),
      })
      .where(eq(cashTransactions.id, id));

    await audit.log(
      {
        action: "cash_transaction.cancel",
        entityType: "cash_transaction",
        entityId: id,
        actorId: actor.userId,
        before: { status: "draft" },
        after: { status: "cancelled", reason: input.reason },
      },
      tx,
    );

    return requireTransaction(tx, id);
  });
}

export async function reverseCashTransaction(
  actor: AuthContext,
  id: string,
  input: ReverseCashTransactionInput,
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.cash_transactions.manage");

  return inTx(externalTx, async (tx) => {
    const locked = await lockTransaction(tx, id);
    if (locked.status !== "posted") {
      throw businessRule("Hanya transaksi terposting yang dapat direversal.");
    }

    const txn = await requireTransaction(tx, id);
    if (!txn.journalEntryId) {
      throw businessRule("Transaksi ini tidak memiliki jurnal untuk direversal.");
    }

    const [journal] = await tx
      .select({ status: journalEntries.status })
      .from(journalEntries)
      .where(eq(journalEntries.id, txn.journalEntryId))
      .limit(1);
    if (!journal || journal.status !== "posted") {
      throw businessRule("Jurnal transaksi ini tidak dalam status posted.");
    }

    await reverseJournal(
      actor,
      txn.journalEntryId,
      { reason: input.reason, entryDate: input.entryDate },
      tx,
    );

    await tx
      .update(cashTransactions)
      .set({
        status: "reversed",
        reason: input.reason,
        updatedBy: actor.userId,
        updatedAt: new Date(),
      })
      .where(eq(cashTransactions.id, id));

    await audit.log(
      {
        action: "cash_transaction.reverse",
        entityType: "cash_transaction",
        entityId: id,
        actorId: actor.userId,
        before: { status: "posted" },
        after: { status: "reversed", reason: input.reason, journalEntryId: txn.journalEntryId },
      },
      tx,
    );

    return requireTransaction(tx, id);
  });
}

