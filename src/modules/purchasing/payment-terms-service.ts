import { and, asc, eq, type SQL } from "drizzle-orm";

import { paymentTerms } from "@/db/schema";
import type {
  CreatePaymentTermInput,
  ListPaymentTermsQuery,
  UpdatePaymentTermInput,
} from "@/modules/purchasing/schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { conflict, forbidden, notFound } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Tx | typeof db;

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

const columns = {
  id: paymentTerms.id,
  code: paymentTerms.code,
  name: paymentTerms.name,
  dueInDays: paymentTerms.dueInDays,
  description: paymentTerms.description,
  isActive: paymentTerms.isActive,
  createdAt: paymentTerms.createdAt,
  updatedAt: paymentTerms.updatedAt,
};

async function requirePaymentTerm(reader: Reader, id: string) {
  const [row] = await reader
    .select(columns)
    .from(paymentTerms)
    .where(eq(paymentTerms.id, id))
    .limit(1);
  if (!row) throw notFound("Termin pembayaran tidak ditemukan.");
  return row;
}

async function lockPaymentTerm(tx: Tx, id: string) {
  const [row] = await tx
    .select(columns)
    .from(paymentTerms)
    .where(eq(paymentTerms.id, id))
    .for("update")
    .limit(1);
  if (!row) throw notFound("Termin pembayaran tidak ditemukan.");
  return row;
}

/* ------------------------------- Baca ------------------------------ */

export async function listPaymentTerms(
  actor: AuthContext,
  query: ListPaymentTermsQuery = {},
  externalTx?: Tx,
) {
  assertCan(actor, "purchasing.payment_terms.read");
  const reader = externalTx ?? db;

  const conditions: (SQL | undefined)[] = [
    query.isActive === undefined ? undefined : eq(paymentTerms.isActive, query.isActive),
  ];

  return reader
    .select(columns)
    .from(paymentTerms)
    .where(and(...conditions))
    .orderBy(asc(paymentTerms.code));
}

export async function getPaymentTerm(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "purchasing.payment_terms.read");
  return requirePaymentTerm(externalTx ?? db, id);
}

/* ------------------------------- Tulis ----------------------------- */

export async function createPaymentTerm(
  actor: AuthContext,
  input: CreatePaymentTermInput,
  externalTx?: Tx,
) {
  assertCan(actor, "purchasing.payment_terms.manage");

  const run = async (tx: Tx) => {
    const [dup] = await tx
      .select({ id: paymentTerms.id })
      .from(paymentTerms)
      .where(eq(paymentTerms.code, input.code))
      .limit(1);
    if (dup) throw conflict("Kode termin pembayaran sudah dipakai.");

    const values = {
      code: input.code,
      name: input.name,
      dueInDays: input.dueInDays,
      description: input.description ?? null,
    };

    const [created] = await tx
      .insert(paymentTerms)
      .values({ ...values, isActive: true, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: paymentTerms.id });
    if (!created) throw new Error("Gagal membuat termin pembayaran.");

    await audit.log(
      {
        action: "payment_term.create",
        entityType: "payment_term",
        entityId: created.id,
        actorId: actor.userId,
        after: values,
      },
      tx,
    );

    return requirePaymentTerm(tx, created.id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

const UPDATABLE_FIELDS = ["name", "dueInDays", "description", "isActive"] as const;

export async function updatePaymentTerm(
  actor: AuthContext,
  id: string,
  input: UpdatePaymentTermInput,
  externalTx?: Tx,
) {
  assertCan(actor, "purchasing.payment_terms.manage");

  const run = async (tx: Tx) => {
    const current = await lockPaymentTerm(tx, id);

    const next = {
      name: input.name ?? current.name,
      dueInDays: input.dueInDays ?? current.dueInDays,
      description: input.description === undefined ? current.description : input.description,
      isActive: input.isActive ?? current.isActive,
    };

    const changedFields = UPDATABLE_FIELDS.filter((field) => next[field] !== current[field]);
    if (changedFields.length === 0) return current;

    await tx
      .update(paymentTerms)
      .set({ ...next, updatedAt: new Date(), updatedBy: actor.userId })
      .where(eq(paymentTerms.id, id));

    await audit.log(
      {
        action: "payment_term.update",
        entityType: "payment_term",
        entityId: id,
        actorId: actor.userId,
        before: Object.fromEntries(changedFields.map((f) => [f, current[f]])),
        after: Object.fromEntries(changedFields.map((f) => [f, next[f]])),
      },
      tx,
    );

    return requirePaymentTerm(tx, id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

/** Termin aktif untuk pemakaian dokumen; 404 bila tidak ada, BUSINESS_RULE bila nonaktif. */
export async function requireActivePaymentTerm(tx: Tx, id: string, path = "paymentTermsId") {
  const [row] = await tx
    .select({ id: paymentTerms.id, isActive: paymentTerms.isActive, dueInDays: paymentTerms.dueInDays })
    .from(paymentTerms)
    .where(eq(paymentTerms.id, id))
    .for("share")
    .limit(1);
  if (!row) throw notFound("Termin pembayaran tidak ditemukan.");
  if (!row.isActive) {
    throw conflict(`${path === "paymentTermsId" ? "Termin pembayaran" : "Termin"} tidak aktif.`);
  }
  return row;
}
