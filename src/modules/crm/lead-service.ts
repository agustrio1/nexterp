import { and, asc, eq, ilike, or, type SQL } from "drizzle-orm";

import { crmAccounts, crmContacts, crmLeads, users } from "@/db/schema";
import type { ConvertLeadInput, CreateLeadInput, ListQuery, UpdateLeadInput } from "@/modules/crm/schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { businessRule, conflict, forbidden, notFound, validationFailed } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

const leadColumns = {
  id: crmLeads.id,
  name: crmLeads.name,
  source: crmLeads.source,
  status: crmLeads.status,
  contactName: crmLeads.contactName,
  email: crmLeads.email,
  phone: crmLeads.phone,
  company: crmLeads.company,
  convertedAccountId: crmLeads.convertedAccountId,
  convertedContactId: crmLeads.convertedContactId,
  assignedTo: crmLeads.assignedTo,
  assignedToName: users.name,
  notes: crmLeads.notes,
  createdAt: crmLeads.createdAt,
  updatedAt: crmLeads.updatedAt,
};

function leadQuery(reader: Tx | typeof db) {
  return reader
    .select(leadColumns)
    .from(crmLeads)
    .leftJoin(users, eq(users.id, crmLeads.assignedTo));
}

export async function listLeads(actor: AuthContext, query: ListQuery = {}, externalTx?: Tx) {
  assertCan(actor, "crm.leads.read");
  const reader = externalTx ?? db;
  const conditions: (SQL | undefined)[] = [
    query.search === undefined
      ? undefined
      : or(ilike(crmLeads.name, `%${query.search}%`), ilike(crmLeads.company, `%${query.search}%`)),
  ];
  return leadQuery(reader).where(and(...conditions)).orderBy(asc(crmLeads.createdAt));
}

export async function getLead(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "crm.leads.read");
  const [row] = await leadQuery(externalTx ?? db).where(eq(crmLeads.id, id)).limit(1);
  if (!row) throw notFound("Lead tidak ditemukan.");
  return row;
}

export async function createLead(actor: AuthContext, input: CreateLeadInput, externalTx?: Tx) {
  assertCan(actor, "crm.leads.manage");

  const run = async (tx: Tx) => {
    if (input.assignedTo) {
      const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, input.assignedTo)).limit(1);
      if (!u) throw validationFailed([{ path: "assignedTo", message: "Pengguna tidak ditemukan." }]);
    }

    const [row] = await tx
      .insert(crmLeads)
      .values({ ...input, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: crmLeads.id });

    await audit.log({ action: "crm.lead.create", entityType: "crm_leads", entityId: row!.id, actorId: actor.userId }, tx);
    return getLead(actor, row!.id, tx);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function updateLead(actor: AuthContext, id: string, input: UpdateLeadInput, externalTx?: Tx) {
  assertCan(actor, "crm.leads.manage");

  const run = async (tx: Tx) => {
    const [current] = await tx.select({ id: crmLeads.id, status: crmLeads.status }).from(crmLeads).where(eq(crmLeads.id, id)).for("update").limit(1);
    if (!current) throw notFound("Lead tidak ditemukan.");
    if (current.status === "converted") throw businessRule("Lead yang sudah dikonversi tidak dapat diubah.");

    const next: Record<string, unknown> = { updatedAt: new Date(), updatedBy: actor.userId };
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) next[key] = value;
    }

    await tx.update(crmLeads).set(next).where(eq(crmLeads.id, id));
    await audit.log({ action: "crm.lead.update", entityType: "crm_leads", entityId: id, actorId: actor.userId }, tx);
    return getLead(actor, id, tx);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

/** Konversi lead → akun CRM + kontak. Mengubah status lead menjadi 'converted'. */
export async function convertLead(actor: AuthContext, id: string, input: ConvertLeadInput, externalTx?: Tx) {
  assertCan(actor, "crm.leads.manage");

  const run = async (tx: Tx) => {
    const [lead] = await tx.select({ id: crmLeads.id, status: crmLeads.status }).from(crmLeads).where(eq(crmLeads.id, id)).for("update").limit(1);
    if (!lead) throw notFound("Lead tidak ditemukan.");
    if (lead.status === "converted") throw businessRule("Lead sudah dikonversi.");

    // Cek duplikat kode akun
    const [dupAcc] = await tx.select({ id: crmAccounts.id }).from(crmAccounts).where(eq(crmAccounts.code, input.accountCode)).limit(1);
    if (dupAcc) throw conflict(`Kode akun "${input.accountCode}" sudah dipakai.`);

    // Buat akun
    const [account] = await tx
      .insert(crmAccounts)
      .values({ code: input.accountCode, name: input.accountName, type: "prospect", createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: crmAccounts.id });

    // Buat kontak
    const [contact] = await tx
      .insert(crmContacts)
      .values({ accountId: account!.id, name: input.contactName, email: input.contactEmail, phone: input.contactPhone, isPrimary: true, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: crmContacts.id });

    // Update lead
    await tx
      .update(crmLeads)
      .set({ status: "converted", convertedAccountId: account!.id, convertedContactId: contact!.id, updatedAt: new Date(), updatedBy: actor.userId })
      .where(eq(crmLeads.id, id));

    await audit.log({ action: "crm.lead.convert", entityType: "crm_leads", entityId: id, actorId: actor.userId }, tx);
    return { accountId: account!.id, contactId: contact!.id };
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}
