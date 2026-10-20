import { and, asc, eq, type SQL } from "drizzle-orm";

import { crmAccounts, crmContacts } from "@/db/schema";
import type { CreateContactInput, UpdateContactInput } from "@/modules/crm/schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { conflict, forbidden, notFound, validationFailed } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

const contactColumns = {
  id: crmContacts.id,
  accountId: crmContacts.accountId,
  accountName: crmAccounts.name,
  name: crmContacts.name,
  title: crmContacts.title,
  email: crmContacts.email,
  phone: crmContacts.phone,
  isPrimary: crmContacts.isPrimary,
  isActive: crmContacts.isActive,
  createdAt: crmContacts.createdAt,
  updatedAt: crmContacts.updatedAt,
};

export async function listContacts(actor: AuthContext, accountId: string, externalTx?: Tx) {
  assertCan(actor, "crm.contacts.read");
  const reader = externalTx ?? db;
  const conditions: (SQL | undefined)[] = [eq(crmContacts.accountId, accountId)];
  return reader
    .select(contactColumns)
    .from(crmContacts)
    .innerJoin(crmAccounts, eq(crmAccounts.id, crmContacts.accountId))
    .where(and(...conditions))
    .orderBy(asc(crmContacts.name));
}

export async function getContact(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "crm.contacts.read");
  const reader = externalTx ?? db;
  const [row] = await reader
    .select(contactColumns)
    .from(crmContacts)
    .innerJoin(crmAccounts, eq(crmAccounts.id, crmContacts.accountId))
    .where(eq(crmContacts.id, id))
    .limit(1);
  if (!row) throw notFound("Kontak tidak ditemukan.");
  return row;
}

export async function createContact(actor: AuthContext, input: CreateContactInput, externalTx?: Tx) {
  assertCan(actor, "crm.contacts.manage");

  const run = async (tx: Tx) => {
    const [account] = await tx.select({ id: crmAccounts.id }).from(crmAccounts).where(eq(crmAccounts.id, input.accountId)).limit(1);
    if (!account) throw validationFailed([{ path: "accountId", message: "Akun CRM tidak ditemukan." }]);

    // Jika isPrimary, reset kontak utama lainnya
    if (input.isPrimary) {
      await tx.update(crmContacts).set({ isPrimary: false, updatedAt: new Date() }).where(eq(crmContacts.accountId, input.accountId));
    }

    const [row] = await tx
      .insert(crmContacts)
      .values({ ...input, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: crmContacts.id });
    if (!row) throw conflict("Gagal membuat kontak.");

    const result = await getContact(actor, row.id, tx);
    await audit.log({ action: "crm.contact.create", entityType: "crm_contacts", entityId: row.id, actorId: actor.userId }, tx);
    return result;
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function updateContact(actor: AuthContext, id: string, input: UpdateContactInput, externalTx?: Tx) {
  assertCan(actor, "crm.contacts.manage");

  const run = async (tx: Tx) => {
    const [current] = await tx
      .select({ id: crmContacts.id, accountId: crmContacts.accountId })
      .from(crmContacts)
      .where(eq(crmContacts.id, id))
      .for("update")
      .limit(1);
    if (!current) throw notFound("Kontak tidak ditemukan.");

    if (input.isPrimary) {
      await tx.update(crmContacts).set({ isPrimary: false, updatedAt: new Date() }).where(eq(crmContacts.accountId, current.accountId));
    }

    const next: Record<string, unknown> = { updatedAt: new Date(), updatedBy: actor.userId };
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) next[key] = value;
    }

    await tx.update(crmContacts).set(next).where(eq(crmContacts.id, id));
    await audit.log({ action: "crm.contact.update", entityType: "crm_contacts", entityId: id, actorId: actor.userId }, tx);
    return getContact(actor, id, tx);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}
