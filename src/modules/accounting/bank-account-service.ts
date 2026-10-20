import { and, asc, eq, sql } from "drizzle-orm";

import { bankAccounts, branches, cashTransactions, chartAccounts } from "@/db/schema";
import type {
  CreateBankAccountInput,
  ListBankAccountsQuery,
  UpdateBankAccountInput,
} from "@/modules/accounting/cash-schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { businessRule, conflict, forbidden, notFound, validationFailed } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "select">;

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

async function inTx<T>(externalTx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (externalTx) return fn(externalTx);
  return db.transaction(fn);
}

const bankAccountColumns = {
  id: bankAccounts.id,
  code: bankAccounts.code,
  name: bankAccounts.name,
  accountId: bankAccounts.accountId,
  accountCode: chartAccounts.code,
  accountName: chartAccounts.name,
  kind: bankAccounts.kind,
  bankName: bankAccounts.bankName,
  accountNumber: bankAccounts.accountNumber,
  branchId: bankAccounts.branchId,
  isActive: bankAccounts.isActive,
  description: bankAccounts.description,
  createdAt: bankAccounts.createdAt,
  updatedAt: bankAccounts.updatedAt,
};

/** Akun GL penampung harus ada, aktif, postable, dan bertipe aset. */
async function assertAccountUsable(tx: Tx, accountId: string): Promise<void> {
  const [account] = await tx
    .select({
      id: chartAccounts.id,
      code: chartAccounts.code,
      type: chartAccounts.type,
      isActive: chartAccounts.isActive,
      isPostable: chartAccounts.isPostable,
    })
    .from(chartAccounts)
    .where(eq(chartAccounts.id, accountId))
    .limit(1);
  if (!account) {
    throw validationFailed([{ path: "accountId", message: "Akun GL tidak ditemukan." }]);
  }
  if (!account.isActive) throw businessRule(`Akun GL ${account.code} tidak aktif.`);
  if (!account.isPostable) {
    throw businessRule(`Akun GL ${account.code} bukan akun postable (induk pohon).`);
  }
  if (account.type !== "asset") {
    throw businessRule(`Akun GL ${account.code} harus bertipe aset untuk rekening kas/bank.`);
  }
}

async function assertBranchUsable(tx: Tx, branchId: string): Promise<void> {
  const [branch] = await tx
    .select({ id: branches.id, isActive: branches.isActive })
    .from(branches)
    .where(eq(branches.id, branchId))
    .for("share")
    .limit(1);
  if (!branch) throw validationFailed([{ path: "branchId", message: "Cabang tidak ditemukan." }]);
  if (!branch.isActive) throw businessRule("Cabang tidak aktif.");
}

async function requireBankAccount(reader: Reader, id: string) {
  const [row] = await reader
    .select(bankAccountColumns)
    .from(bankAccounts)
    .innerJoin(chartAccounts, eq(chartAccounts.id, bankAccounts.accountId))
    .where(eq(bankAccounts.id, id))
    .limit(1);
  if (!row) throw notFound("Rekening kas/bank tidak ditemukan.");
  return row;
}

async function lockBankAccount(tx: Tx, id: string) {
  const [row] = await tx
    .select(bankAccountColumns)
    .from(bankAccounts)
    .innerJoin(chartAccounts, eq(chartAccounts.id, bankAccounts.accountId))
    .where(eq(bankAccounts.id, id))
    .for("update")
    .limit(1);
  if (!row) throw notFound("Rekening kas/bank tidak ditemukan.");
  return row;
}

/** Jumlah transaksi kas AKTIF (draf/posted) yang memakai rekening ini. */
async function countActiveUsage(reader: Reader, bankAccountId: string) {
  const [row] = await reader
    .select({ count: sql<number>`count(*)::int` })
    .from(cashTransactions)
    .where(
      and(
        eq(cashTransactions.bankAccountId, bankAccountId),
        sql`${cashTransactions.status} in ('draft', 'posted')`,
      ),
    );
  return row?.count ?? 0;
}

/* ------------------------------------------------------------------ */
/* Baca                                                                */
/* ------------------------------------------------------------------ */

export async function listBankAccounts(
  actor: AuthContext,
  query: ListBankAccountsQuery = {},
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.bank_accounts.read");

  const reader: Reader = externalTx ?? db;
  const conditions = [
    query.isActive === undefined ? undefined : eq(bankAccounts.isActive, query.isActive),
    query.kind === undefined ? undefined : eq(bankAccounts.kind, query.kind),
    query.branchId === undefined ? undefined : eq(bankAccounts.branchId, query.branchId),
  ];

  return reader
    .select(bankAccountColumns)
    .from(bankAccounts)
    .innerJoin(chartAccounts, eq(chartAccounts.id, bankAccounts.accountId))
    .where(and(...conditions))
    .orderBy(asc(bankAccounts.code));
}

export async function getBankAccount(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "accounting.bank_accounts.read");
  return requireBankAccount(externalTx ?? db, id);
}

/* ------------------------------------------------------------------ */
/* Tulis                                                               */
/* ------------------------------------------------------------------ */

export async function createBankAccount(
  actor: AuthContext,
  input: CreateBankAccountInput,
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.bank_accounts.manage");

  return inTx(externalTx, async (tx) => {
    const [existing] = await tx
      .select({ id: bankAccounts.id })
      .from(bankAccounts)
      .where(eq(bankAccounts.code, input.code))
      .limit(1);
    if (existing) throw conflict("Kode rekening sudah dipakai.");

    await assertAccountUsable(tx, input.accountId);

    const branchId = input.branchId ?? null;
    if (branchId !== null) await assertBranchUsable(tx, branchId);

    const values = {
      code: input.code,
      name: input.name,
      accountId: input.accountId,
      kind: input.kind,
      bankName: input.bankName ?? null,
      accountNumber: input.accountNumber ?? null,
      branchId,
      description: input.description ?? null,
    };

    const [created] = await tx
      .insert(bankAccounts)
      .values({ ...values, isActive: true, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: bankAccounts.id });
    if (!created) throw new Error("Gagal membuat rekening kas/bank.");

    await audit.log(
      {
        action: "bank_account.create",
        entityType: "bank_account",
        entityId: created.id,
        actorId: actor.userId,
        after: values,
      },
      tx,
    );

    return requireBankAccount(tx, created.id);
  });
}

const UPDATABLE_FIELDS = [
  "name",
  "accountId",
  "kind",
  "bankName",
  "accountNumber",
  "branchId",
  "isActive",
  "description",
] as const;

export async function updateBankAccount(
  actor: AuthContext,
  id: string,
  input: UpdateBankAccountInput,
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.bank_accounts.manage");

  return inTx(externalTx, async (tx) => {
    const current = await lockBankAccount(tx, id);

    const next = {
      name: input.name ?? current.name,
      accountId: input.accountId ?? current.accountId,
      kind: input.kind ?? current.kind,
      bankName: input.bankName === undefined ? current.bankName : input.bankName,
      accountNumber:
        input.accountNumber === undefined ? current.accountNumber : input.accountNumber,
      branchId: input.branchId === undefined ? current.branchId : input.branchId,
      isActive: input.isActive ?? current.isActive,
      description: input.description === undefined ? current.description : input.description,
    };

    const changedFields = UPDATABLE_FIELDS.filter((field) => next[field] !== current[field]);
    if (changedFields.length === 0) return current;

    if (next.accountId !== current.accountId) await assertAccountUsable(tx, next.accountId);
    if (next.branchId !== current.branchId && next.branchId !== null) {
      await assertBranchUsable(tx, next.branchId);
    }

    const deactivating = current.isActive && !next.isActive;
    if (deactivating) {
      const used = await countActiveUsage(tx, id);
      if (used > 0) {
        throw conflict(`Rekening masih dipakai ${used} transaksi kas aktif (draf/posted).`);
      }
    }

    await tx
      .update(bankAccounts)
      .set({ ...next, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(bankAccounts.id, id));

    await audit.log(
      {
        action: "bank_account.update",
        entityType: "bank_account",
        entityId: id,
        actorId: actor.userId,
        before: Object.fromEntries(changedFields.map((field) => [field, current[field]])),
        after: Object.fromEntries(changedFields.map((field) => [field, next[field]])),
      },
      tx,
    );

    return requireBankAccount(tx, id);
  });
}
