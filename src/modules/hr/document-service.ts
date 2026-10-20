import { desc, eq } from "drizzle-orm";

import { employeeDocuments } from "@/db/schema";
import type { CreateDocumentInput, UpdateDocumentInput } from "@/modules/hr/schemas";
import { assertCan, requireActiveEmployee } from "@/modules/hr/_refs";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { notFound } from "@/server/errors";
import type { AuthContext } from "@/server/authz";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const columns = {
  id: employeeDocuments.id,
  employeeId: employeeDocuments.employeeId,
  category: employeeDocuments.category,
  name: employeeDocuments.name,
  externalRef: employeeDocuments.externalRef,
  notes: employeeDocuments.notes,
  capturedAt: employeeDocuments.capturedAt,
  createdAt: employeeDocuments.createdAt,
  updatedAt: employeeDocuments.updatedAt,
};

async function requireDocument(reader: Tx | typeof db, id: string) {
  const [row] = await reader.select(columns).from(employeeDocuments).where(eq(employeeDocuments.id, id)).limit(1);
  if (!row) throw notFound("Dokumen tidak ditemukan.");
  return row;
}

export async function listDocuments(actor: AuthContext, employeeId: string, externalTx?: Tx) {
  assertCan(actor, "hr.documents.read");
  const reader = externalTx ?? db;
  return reader
    .select(columns)
    .from(employeeDocuments)
    .where(eq(employeeDocuments.employeeId, employeeId))
    .orderBy(desc(employeeDocuments.capturedAt));
}

export async function getDocument(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "hr.documents.read");
  return requireDocument(externalTx ?? db, id);
}

export async function createDocument(actor: AuthContext, input: CreateDocumentInput, externalTx?: Tx) {
  assertCan(actor, "hr.documents.manage");
  const run = async (tx: Tx) => {
    await requireActiveEmployee(tx, input.employeeId);
    const values = {
      employeeId: input.employeeId,
      category: input.category,
      name: input.name,
      externalRef: input.externalRef ?? null,
      notes: input.notes ?? null,
      capturedAt: input.capturedAt ? new Date(input.capturedAt) : new Date(),
    };
    const [created] = await tx
      .insert(employeeDocuments)
      .values({ ...values, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: employeeDocuments.id });
    if (!created) throw new Error("Gagal membuat dokumen.");
    await audit.log({ action: "hr.document.create", entityType: "employee_document", entityId: created.id, actorId: actor.userId, after: { employeeId: values.employeeId, category: values.category } }, tx);
    return requireDocument(tx, created.id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function updateDocument(actor: AuthContext, id: string, input: UpdateDocumentInput, externalTx?: Tx) {
  assertCan(actor, "hr.documents.manage");
  const run = async (tx: Tx) => {
    const current = await requireDocument(tx, id);
    const next = {
      category: input.category ?? current.category,
      name: input.name ?? current.name,
      externalRef: input.externalRef === undefined ? current.externalRef : input.externalRef,
      notes: input.notes === undefined ? current.notes : input.notes,
    };
    await tx.update(employeeDocuments).set({ ...next, updatedBy: actor.userId, updatedAt: new Date() }).where(eq(employeeDocuments.id, id));
    await audit.log({ action: "hr.document.update", entityType: "employee_document", entityId: id, actorId: actor.userId, after: next }, tx);
    return requireDocument(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function deleteDocument(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "hr.documents.manage");
  const run = async (tx: Tx) => {
    const current = await requireDocument(tx, id);
    await tx.delete(employeeDocuments).where(eq(employeeDocuments.id, id));
    await audit.log({ action: "hr.document.delete", entityType: "employee_document", entityId: id, actorId: actor.userId, before: { employeeId: current.employeeId, name: current.name } }, tx);
    return { id };
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}
