import { and, asc, eq, inArray } from "drizzle-orm";

import { salaryComponents, salaryStructureComponents, salaryStructures } from "@/db/schema";
import type {
  AttachComponentsInput,
  CreateStructureInput,
  UpdateStructureInput,
} from "@/modules/payroll/schemas";
import {
  assertCan,
  inTx,
  requireActiveComponent,
  requireStructure,
  type Reader,
  type Tx,
} from "@/modules/payroll/_refs";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { conflict } from "@/server/errors";
import type { AuthContext } from "@/server/authz";

const columns = {
  id: salaryStructures.id,
  code: salaryStructures.code,
  name: salaryStructures.name,
  payFrequency: salaryStructures.payFrequency,
  isActive: salaryStructures.isActive,
  createdAt: salaryStructures.createdAt,
  updatedAt: salaryStructures.updatedAt,
};

async function loadStructureComponents(reader: Reader, structureId: string) {
  return reader
    .select({
      componentId: salaryStructureComponents.componentId,
      code: salaryComponents.code,
      name: salaryComponents.name,
      kind: salaryComponents.kind,
      orderNo: salaryComponents.orderNo,
    })
    .from(salaryStructureComponents)
    .innerJoin(salaryComponents, eq(salaryComponents.id, salaryStructureComponents.componentId))
    .where(eq(salaryStructureComponents.structureId, structureId))
    .orderBy(asc(salaryComponents.orderNo), asc(salaryComponents.code));
}

async function withComponents(reader: Reader, id: string) {
  const structure = await requireStructure(reader, id);
  const components = await loadStructureComponents(reader, id);
  return { ...structure, components };
}

export async function listStructures(
  actor: AuthContext,
  query: { isActive?: boolean } = {},
  externalTx?: Tx,
) {
  assertCan(actor, "payroll.structures.read");
  const reader = externalTx ?? db;
  const rows = await reader
    .select(columns)
    .from(salaryStructures)
    .where(query.isActive === undefined ? undefined : eq(salaryStructures.isActive, query.isActive))
    .orderBy(asc(salaryStructures.code));
  return rows;
}

export async function getStructure(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "payroll.structures.read");
  return withComponents(externalTx ?? db, id);
}

export async function createStructure(actor: AuthContext, input: CreateStructureInput, externalTx?: Tx) {
  assertCan(actor, "payroll.structures.manage");
  return inTx(externalTx, async (tx) => {
    const [existing] = await tx
      .select({ id: salaryStructures.id })
      .from(salaryStructures)
      .where(eq(salaryStructures.code, input.code))
      .limit(1);
    if (existing) throw conflict("Kode struktur sudah dipakai.");

    const [created] = await tx
      .insert(salaryStructures)
      .values({
        code: input.code,
        name: input.name,
        payFrequency: input.payFrequency,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: salaryStructures.id });
    if (!created) throw new Error("Gagal membuat struktur gaji.");
    await audit.log(
      {
        action: "payroll.structure.create",
        entityType: "salary_structure",
        entityId: created.id,
        actorId: actor.userId,
        after: { code: input.code, name: input.name, payFrequency: input.payFrequency },
      },
      tx,
    );
    return withComponents(tx, created.id);
  });
}

export async function updateStructure(
  actor: AuthContext,
  id: string,
  input: UpdateStructureInput,
  externalTx?: Tx,
) {
  assertCan(actor, "payroll.structures.manage");
  return inTx(externalTx, async (tx) => {
    const current = await requireStructure(tx, id);
    const next = {
      name: input.name ?? current.name,
      payFrequency: input.payFrequency ?? current.payFrequency,
      isActive: input.isActive ?? current.isActive,
    };
    await tx
      .update(salaryStructures)
      .set({ ...next, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(salaryStructures.id, id));
    await audit.log(
      { action: "payroll.structure.update", entityType: "salary_structure", entityId: id, actorId: actor.userId, after: next },
      tx,
    );
    return withComponents(tx, id);
  });
}

/**
 * Sinkronkan keanggotaan komponen struktur dengan daftar yang diberikan
 * (replace-semantik): komponen baru dilampirkan, yang tidak lagi disebutkan dilepas.
 */
export async function setStructureComponents(
  actor: AuthContext,
  id: string,
  input: AttachComponentsInput,
  externalTx?: Tx,
) {
  assertCan(actor, "payroll.structures.manage");
  return inTx(externalTx, async (tx) => {
    await requireStructure(tx, id);
    const wanted = [...new Set(input.componentIds)];
    for (const cid of wanted) await requireActiveComponent(tx, cid);

    const existing = await tx
      .select({ componentId: salaryStructureComponents.componentId })
      .from(salaryStructureComponents)
      .where(eq(salaryStructureComponents.structureId, id));
    const existingIds = new Set(existing.map((r) => r.componentId));
    const toAdd = wanted.filter((cid) => !existingIds.has(cid));
    const toRemove = [...existingIds].filter((cid) => !wanted.includes(cid));

    if (toRemove.length > 0) {
      await tx
        .delete(salaryStructureComponents)
        .where(
          and(
            eq(salaryStructureComponents.structureId, id),
            inArray(salaryStructureComponents.componentId, toRemove),
          ),
        );
    }
    if (toAdd.length > 0) {
      await tx.insert(salaryStructureComponents).values(
        toAdd.map((componentId) => ({
          structureId: id,
          componentId,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        })),
      );
    }
    await audit.log(
      {
        action: "payroll.structure.set_components",
        entityType: "salary_structure",
        entityId: id,
        actorId: actor.userId,
        after: { added: toAdd, removed: toRemove },
      },
      tx,
    );
    return withComponents(tx, id);
  });
}

export async function getStructureComponentIds(tx: Tx, structureId: string): Promise<string[]> {
  const rows = await tx
    .select({ componentId: salaryStructureComponents.componentId })
    .from(salaryStructureComponents)
    .where(eq(salaryStructureComponents.structureId, structureId));
  return rows.map((r) => r.componentId);
}
