import { and, asc, eq, ilike, or, type SQL } from "drizzle-orm";

import { crmAccounts } from "@/db/schema";
import type { CreateAccountInput, ListQuery, UpdateAccountInput } from "@/modules/crm/schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { conflict, forbidden, notFound } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

const accountColumns = {
  id: crmAccounts.id,
  code: crmAccounts.code,
  name: crmAccounts.name,
  type: crmAccounts.type,
  taxId: crmAccounts.taxId,
  address: crmAccounts.address,
  city: crmAccounts.city,
  province: crmAccounts.province,
  country: crmAccounts.country,
  phone: crmAccounts.phone,
  email: crmAccounts.email,
  website: crmAccounts.website,
  notes: crmAccounts.notes,
  isActive: crmAccounts.isActive,
  createdAt: crmAccounts.createdAt,
  updatedAt: crmAccounts.updatedAt,
};

/* ------------------------------- Baca ------------------------------ */

export async function listAccounts(actor: AuthContext, query: ListQuery = {}, externalTx?: Tx) {
  assertCan(actor, "crm.accounts.read");
  const reader = externalTx ?? db;

  const conditions: (SQL | undefined)[] = [
    query.isActive === undefined ? undefined : eq(crmAccounts.isActive, query.isActive),
    query.search === undefined
      ? undefined
      : or(ilike(crmAccounts.name, `%${query.search}%`), ilike(crmAccounts.code, `%${query.search}%`)),
  ];

  return reader
    .select(accountColumns)
    .from(crmAccounts)
    .where(and(...conditions))
    .orderBy(asc(crmAccounts.code));
}

export async function getAccount(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "crm.accounts.read");
  const reader = externalTx ?? db;
  const [row] = await reader.select(accountColumns).from(crmAccounts).where(eq(crmAccounts.id, id)).limit(1);
  if (!row) throw notFound("Akun CRM tidak ditemukan.");
  return row;
}

/* ------------------------------- Tulis ----------------------------- */

export async function createAccount(actor: AuthContext, input: CreateAccountInput, externalTx?: Tx) {
  assertCan(actor, "crm.accounts.manage");

  const run = async (tx: Tx) => {
    const [existing] = await tx.select({ id: crmAccounts.id }).from(crmAccounts).where(eq(crmAccounts.code, input.code)).limit(1);
    if (existing) throw conflict(`Kode akun "${input.code}" sudah dipakai.`);

    const [row] = await tx
      .insert(crmAccounts)
      .values({ ...input, createdBy: actor.userId, updatedBy: actor.userId })
      .returning(accountColumns);

    await audit.log({ action: "crm.account.create", entityType: "crm_accounts", entityId: row!.id, actorId: actor.userId }, tx);
    return row!;
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function updateAccount(actor: AuthContext, id: string, input: UpdateAccountInput, externalTx?: Tx) {
  assertCan(actor, "crm.accounts.manage");

  const run = async (tx: Tx) => {
    const [current] = await tx
      .select({ id: crmAccounts.id, isActive: crmAccounts.isActive })
      .from(crmAccounts)
      .where(eq(crmAccounts.id, id))
      .for("update")
      .limit(1);
    if (!current) throw notFound("Akun CRM tidak ditemukan.");

    const next: Record<string, unknown> = { updatedAt: new Date(), updatedBy: actor.userId };
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) next[key] = value;
    }

    const [row] = await tx.update(crmAccounts).set(next).where(eq(crmAccounts.id, id)).returning(accountColumns);
    await audit.log({ action: "crm.account.update", entityType: "crm_accounts", entityId: id, actorId: actor.userId }, tx);
    return row!;
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}
