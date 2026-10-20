import { and, desc, eq, type SQL } from "drizzle-orm";

import { crmAccounts, crmContacts, crmNotes, crmOpportunities, users } from "@/db/schema";
import type { CreateNoteInput } from "@/modules/crm/schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { forbidden } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

const noteColumns = {
  id: crmNotes.id,
  accountId: crmNotes.accountId,
  accountName: crmAccounts.name,
  contactId: crmNotes.contactId,
  opportunityId: crmNotes.opportunityId,
  content: crmNotes.content,
  authorId: crmNotes.authorId,
  authorName: users.name,
  createdAt: crmNotes.createdAt,
};

function noteQuery(reader: Tx | typeof db) {
  return reader
    .select(noteColumns)
    .from(crmNotes)
    .leftJoin(crmAccounts, eq(crmAccounts.id, crmNotes.accountId))
    .leftJoin(crmContacts, eq(crmContacts.id, crmNotes.contactId))
    .leftJoin(crmOpportunities, eq(crmOpportunities.id, crmNotes.opportunityId))
    .leftJoin(users, eq(users.id, crmNotes.authorId));
}

export async function listNotes(actor: AuthContext, filters: { accountId?: string; opportunityId?: string } = {}, externalTx?: Tx) {
  assertCan(actor, "crm.notes.read");
  const reader = externalTx ?? db;
  const conditions: (SQL | undefined)[] = [
    filters.accountId ? eq(crmNotes.accountId, filters.accountId) : undefined,
    filters.opportunityId ? eq(crmNotes.opportunityId, filters.opportunityId) : undefined,
  ];
  return noteQuery(reader).where(and(...conditions)).orderBy(desc(crmNotes.createdAt));
}

export async function createNote(actor: AuthContext, input: CreateNoteInput, externalTx?: Tx) {
  assertCan(actor, "crm.notes.manage");
  const run = async (tx: Tx) => {
    const [row] = await tx.insert(crmNotes).values({ ...input, authorId: actor.userId, createdBy: actor.userId, updatedBy: actor.userId }).returning({ id: crmNotes.id });
    await audit.log({ action: "crm.note.create", entityType: "crm_notes", entityId: row!.id, actorId: actor.userId }, tx);
    const [note] = await noteQuery(tx).where(eq(crmNotes.id, row!.id)).limit(1);
    return note!;
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}
