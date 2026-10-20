import { and, asc, eq, ilike, or, type SQL } from "drizzle-orm";

import { crmAccounts, customers, paymentTerms, priceLists } from "@/db/schema";
import type { CreateCustomerInput, ListQuery, UpdateCustomerInput } from "@/modules/crm/schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { conflict, forbidden, notFound, validationFailed } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

const customerColumns = {
  id: customers.id,
  crmAccountId: customers.crmAccountId,
  accountName: crmAccounts.name,
  code: customers.code,
  creditLimit: customers.creditLimit,
  paymentTermsId: customers.paymentTermsId,
  paymentTermsName: paymentTerms.name,
  priceListId: customers.priceListId,
  priceListName: priceLists.name,
  currency: customers.currency,
  isActive: customers.isActive,
  createdAt: customers.createdAt,
  updatedAt: customers.updatedAt,
};

function customerQuery(reader: Tx | typeof db) {
  return reader
    .select(customerColumns)
    .from(customers)
    .innerJoin(crmAccounts, eq(crmAccounts.id, customers.crmAccountId))
    .leftJoin(paymentTerms, eq(paymentTerms.id, customers.paymentTermsId))
    .leftJoin(priceLists, eq(priceLists.id, customers.priceListId));
}

export async function listCustomers(actor: AuthContext, query: ListQuery = {}, externalTx?: Tx) {
  assertCan(actor, "crm.customers.read");
  const reader = externalTx ?? db;
  const conditions: (SQL | undefined)[] = [
    query.isActive === undefined ? undefined : eq(customers.isActive, query.isActive),
    query.search === undefined
      ? undefined
      : or(ilike(customers.code, `%${query.search}%`), ilike(crmAccounts.name, `%${query.search}%`)),
  ];
  return customerQuery(reader).where(and(...conditions)).orderBy(asc(customers.code));
}

export async function getCustomer(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "crm.customers.read");
  const [row] = await customerQuery(externalTx ?? db).where(eq(customers.id, id)).limit(1);
  if (!row) throw notFound("Pelanggan tidak ditemukan.");
  return row;
}

export async function createCustomer(actor: AuthContext, input: CreateCustomerInput, externalTx?: Tx) {
  assertCan(actor, "crm.customers.manage");

  const run = async (tx: Tx) => {
    const [dup] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.code, input.code)).limit(1);
    if (dup) throw conflict(`Kode pelanggan "${input.code}" sudah dipakai.`);

    const [account] = await tx.select({ id: crmAccounts.id }).from(crmAccounts).where(eq(crmAccounts.id, input.crmAccountId)).limit(1);
    if (!account) throw validationFailed([{ path: "crmAccountId", message: "Akun CRM tidak ditemukan." }]);

    const [existingCustomer] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.crmAccountId, input.crmAccountId)).limit(1);
    if (existingCustomer) throw conflict("Akun CRM ini sudah memiliki catatan pelanggan.");

    const [row] = await tx
      .insert(customers)
      .values({ ...input, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: customers.id });

    await audit.log({ action: "crm.customer.create", entityType: "customers", entityId: row!.id, actorId: actor.userId }, tx);
    return getCustomer(actor, row!.id, tx);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function updateCustomer(actor: AuthContext, id: string, input: UpdateCustomerInput, externalTx?: Tx) {
  assertCan(actor, "crm.customers.manage");

  const run = async (tx: Tx) => {
    const [current] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, id)).for("update").limit(1);
    if (!current) throw notFound("Pelanggan tidak ditemukan.");

    const next: Record<string, unknown> = { updatedAt: new Date(), updatedBy: actor.userId };
    for (const [key, value] of Object.entries(input)) { if (value !== undefined) next[key] = value; }

    await tx.update(customers).set(next).where(eq(customers.id, id));
    await audit.log({ action: "crm.customer.update", entityType: "customers", entityId: id, actorId: actor.userId }, tx);
    return getCustomer(actor, id, tx);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}
