import { and, asc, eq } from "drizzle-orm";

import { salaryComponents } from "@/db/schema";
import type { CreateComponentInput, UpdateComponentInput } from "@/modules/payroll/schemas";
import { assertCan, inTx, type Reader, type Tx } from "@/modules/payroll/_refs";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { conflict, notFound } from "@/server/errors";
import type { AuthContext } from "@/server/authz";

const columns = {
  id: salaryComponents.id,
  code: salaryComponents.code,
  name: salaryComponents.name,
  kind: salaryComponents.kind,
  basis: salaryComponents.basis,
  statutoryKind: salaryComponents.statutoryKind,
  orderNo: salaryComponents.orderNo,
  includeInTaxBase: salaryComponents.includeInTaxBase,
  includeInBpjsBase: salaryComponents.includeInBpjsBase,
  isActive: salaryComponents.isActive,
  createdAt: salaryComponents.createdAt,
  updatedAt: salaryComponents.updatedAt,
};

async function requireComponent(reader: Reader, id: string) {
  const [row] = await reader
    .select(columns)
    .from(salaryComponents)
    .where(eq(salaryComponents.id, id))
    .limit(1);
  if (!row) throw notFound("Komponen gaji tidak ditemukan.");
  return row;
}

export async function listComponents(
  actor: AuthContext,
  query: { isActive?: boolean; kind?: "earning" | "deduction" } = {},
  externalTx?: Tx,
) {
  assertCan(actor, "payroll.components.read");
  const reader = externalTx ?? db;
  return reader
    .select(columns)
    .from(salaryComponents)
    .where(
      and(
        query.isActive === undefined ? undefined : eq(salaryComponents.isActive, query.isActive),
        query.kind === undefined ? undefined : eq(salaryComponents.kind, query.kind),
      ),
    )
    .orderBy(asc(salaryComponents.orderNo), asc(salaryComponents.code));
}

export async function getComponent(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "payroll.components.read");
  return requireComponent(externalTx ?? db, id);
}

export async function createComponent(actor: AuthContext, input: CreateComponentInput, externalTx?: Tx) {
  assertCan(actor, "payroll.components.manage");
  return inTx(externalTx, async (tx) => {
    const [existing] = await tx
      .select({ id: salaryComponents.id })
      .from(salaryComponents)
      .where(eq(salaryComponents.code, input.code))
      .limit(1);
    if (existing) throw conflict("Kode komponen sudah dipakai.");

    const [created] = await tx
      .insert(salaryComponents)
      .values({
        code: input.code,
        name: input.name,
        kind: input.kind,
        basis: input.basis,
        statutoryKind: input.statutoryKind ?? null,
        orderNo: input.orderNo ?? 1,
        includeInTaxBase: input.includeInTaxBase,
        includeInBpjsBase: input.includeInBpjsBase,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: salaryComponents.id });
    if (!created) throw new Error("Gagal membuat komponen gaji.");
    await audit.log(
      {
        action: "payroll.component.create",
        entityType: "salary_component",
        entityId: created.id,
        actorId: actor.userId,
        after: { code: input.code, kind: input.kind, basis: input.basis },
      },
      tx,
    );
    return requireComponent(tx, created.id);
  });
}

export async function updateComponent(
  actor: AuthContext,
  id: string,
  input: UpdateComponentInput,
  externalTx?: Tx,
) {
  assertCan(actor, "payroll.components.manage");
  return inTx(externalTx, async (tx) => {
    const current = await requireComponent(tx, id);
    const next = {
      name: input.name ?? current.name,
      kind: input.kind ?? current.kind,
      basis: input.basis ?? current.basis,
      statutoryKind: input.statutoryKind === undefined ? current.statutoryKind : input.statutoryKind,
      orderNo: input.orderNo ?? current.orderNo,
      includeInTaxBase: input.includeInTaxBase ?? current.includeInTaxBase,
      includeInBpjsBase: input.includeInBpjsBase ?? current.includeInBpjsBase,
      isActive: input.isActive ?? current.isActive,
    };
    await tx
      .update(salaryComponents)
      .set({ ...next, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(salaryComponents.id, id));
    await audit.log(
      { action: "payroll.component.update", entityType: "salary_component", entityId: id, actorId: actor.userId, after: next },
      tx,
    );
    return requireComponent(tx, id);
  });
}
