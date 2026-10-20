import { alias } from "drizzle-orm/pg-core";
import { and, asc, eq, sql } from "drizzle-orm";

import { products, unitConversions, unitsOfMeasure } from "@/db/schema";
import type {
  CreateUnitConversionInput,
  CreateUnitInput,
  ListUnitConversionsQuery,
  ListUnitsQuery,
  UpdateUnitConversionInput,
  UpdateUnitInput,
} from "@/modules/inventory/schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { businessRule, conflict, forbidden, notFound, validationFailed } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "select">;

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

/* ------------------------------ Units ------------------------------ */

const unitColumns = {
  id: unitsOfMeasure.id,
  code: unitsOfMeasure.code,
  name: unitsOfMeasure.name,
  symbol: unitsOfMeasure.symbol,
  isActive: unitsOfMeasure.isActive,
  createdAt: unitsOfMeasure.createdAt,
  updatedAt: unitsOfMeasure.updatedAt,
};

async function requireUnit(reader: Reader, id: string) {
  const [row] = await reader
    .select(unitColumns)
    .from(unitsOfMeasure)
    .where(eq(unitsOfMeasure.id, id))
    .limit(1);
  if (!row) throw notFound("Satuan tidak ditemukan.");
  return row;
}

/** Satuan harus ada & aktif (dipakai validasi produk & konversi). */
export async function assertActiveUnit(tx: Tx, id: string, path = "baseUnitId"): Promise<void> {
  const [row] = await tx
    .select({ id: unitsOfMeasure.id, isActive: unitsOfMeasure.isActive })
    .from(unitsOfMeasure)
    .where(eq(unitsOfMeasure.id, id))
    .for("share")
    .limit(1);
  if (!row) {
    throw validationFailed([{ path, message: "Satuan tidak ditemukan." }]);
  }
  if (!row.isActive) {
    throw businessRule("Satuan tidak aktif.");
  }
}

async function countUnitUsage(tx: Tx, unitId: string): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(products)
    .where(eq(products.baseUnitId, unitId));
  const [conv] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(unitConversions)
    .where(
      sql`${unitConversions.fromUnitId} = ${unitId} or ${unitConversions.toUnitId} = ${unitId}`,
    );
  return (row?.count ?? 0) + (conv?.count ?? 0);
}

export async function listUnits(actor: AuthContext, query: ListUnitsQuery = {}, externalTx?: Tx) {
  assertCan(actor, "inventory.units.read");
  const reader = externalTx ?? db;
  return reader
    .select(unitColumns)
    .from(unitsOfMeasure)
    .where(
      query.isActive === undefined ? undefined : eq(unitsOfMeasure.isActive, query.isActive),
    )
    .orderBy(asc(unitsOfMeasure.code));
}

export async function getUnit(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "inventory.units.read");
  return requireUnit(externalTx ?? db, id);
}

export async function createUnit(actor: AuthContext, input: CreateUnitInput, externalTx?: Tx) {
  assertCan(actor, "inventory.units.manage");

  const run = async (tx: Tx) => {
    const [dup] = await tx
      .select({ id: unitsOfMeasure.id })
      .from(unitsOfMeasure)
      .where(eq(unitsOfMeasure.code, input.code))
      .limit(1);
    if (dup) throw conflict("Kode satuan sudah dipakai.");

    const values = { code: input.code, name: input.name, symbol: input.symbol ?? null };
    const [created] = await tx
      .insert(unitsOfMeasure)
      .values({ ...values, isActive: true, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: unitsOfMeasure.id });
    if (!created) throw new Error("Gagal membuat satuan.");

    await audit.log(
      {
        action: "unit.create",
        entityType: "unit_of_measure",
        entityId: created.id,
        actorId: actor.userId,
        after: values,
      },
      tx,
    );
    return requireUnit(tx, created.id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function updateUnit(actor: AuthContext, id: string, input: UpdateUnitInput, externalTx?: Tx) {
  assertCan(actor, "inventory.units.manage");

  const run = async (tx: Tx) => {
    const unit = await requireUnit(tx, id);
    const next = {
      name: input.name ?? unit.name,
      symbol: input.symbol === undefined ? unit.symbol : input.symbol,
      isActive: input.isActive ?? unit.isActive,
    };
    const changed =
      next.name !== unit.name || next.symbol !== unit.symbol || next.isActive !== unit.isActive;
    if (!changed) return unit;

    if (unit.isActive && !next.isActive) {
      const usage = await countUnitUsage(tx, id);
      if (usage > 0) {
        throw conflict(`Satuan masih dipakai oleh ${usage} rujukan (produk/konversi).`);
      }
    }

    await tx
      .update(unitsOfMeasure)
      .set({ ...next, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(unitsOfMeasure.id, id));

    await audit.log(
      {
        action: "unit.update",
        entityType: "unit_of_measure",
        entityId: id,
        actorId: actor.userId,
        before: { name: unit.name, symbol: unit.symbol, isActive: unit.isActive },
        after: next,
      },
      tx,
    );
    return requireUnit(tx, id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

/* --------------------------- Conversions --------------------------- */

const conversionColumns = {
  id: unitConversions.id,
  fromUnitId: unitConversions.fromUnitId,
  fromUnitCode: unitsOfMeasure.code,
  toUnitId: unitConversions.toUnitId,
  ratio: unitConversions.ratio,
  note: unitConversions.note,
  createdAt: unitConversions.createdAt,
  updatedAt: unitConversions.updatedAt,
};

const toUnits = alias(unitsOfMeasure, "to_unit");

function conversionQuery(reader: Reader) {
  return reader
    .select({
      ...conversionColumns,
      fromUnitName: unitsOfMeasure.name,
      toUnitCode: toUnits.code,
      toUnitName: toUnits.name,
    })
    .from(unitConversions)
    .innerJoin(unitsOfMeasure, eq(unitsOfMeasure.id, unitConversions.fromUnitId))
    .innerJoin(toUnits, eq(toUnits.id, unitConversions.toUnitId));
}

async function requireConversion(reader: Reader, id: string) {
  const [row] = await conversionQuery(reader).where(eq(unitConversions.id, id)).limit(1);
  if (!row) throw notFound("Konversi satuan tidak ditemukan.");
  return row;
}

export async function listUnitConversions(
  actor: AuthContext,
  query: ListUnitConversionsQuery = {},
  externalTx?: Tx,
) {
  assertCan(actor, "inventory.units.read");
  const reader = externalTx ?? db;
  const conditions = [
    query.fromUnitId === undefined ? undefined : eq(unitConversions.fromUnitId, query.fromUnitId),
    query.toUnitId === undefined ? undefined : eq(unitConversions.toUnitId, query.toUnitId),
  ];
  return conversionQuery(reader)
    .where(and(...conditions))
    .orderBy(asc(unitsOfMeasure.code), asc(toUnits.code));
}

export async function getUnitConversion(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "inventory.units.read");
  return requireConversion(externalTx ?? db, id);
}

export async function createUnitConversion(
  actor: AuthContext,
  input: CreateUnitConversionInput,
  externalTx?: Tx,
) {
  assertCan(actor, "inventory.units.manage");

  const run = async (tx: Tx) => {
    await assertActiveUnit(tx, input.fromUnitId, "fromUnitId");
    await assertActiveUnit(tx, input.toUnitId, "toUnitId");

    const [dup] = await tx
      .select({ id: unitConversions.id })
      .from(unitConversions)
      .where(
        and(
          eq(unitConversions.fromUnitId, input.fromUnitId),
          eq(unitConversions.toUnitId, input.toUnitId),
        ),
      )
      .limit(1);
    if (dup) throw conflict("Konversi untuk pasangannya sudah ada.");

    const values = {
      fromUnitId: input.fromUnitId,
      toUnitId: input.toUnitId,
      ratio: input.ratio,
      note: input.note ?? null,
    };
    const [created] = await tx
      .insert(unitConversions)
      .values({ ...values, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: unitConversions.id });
    if (!created) throw new Error("Gagal membuat konversi satuan.");

    await audit.log(
      {
        action: "unit_conversion.create",
        entityType: "unit_conversion",
        entityId: created.id,
        actorId: actor.userId,
        after: values,
      },
      tx,
    );
    return requireConversion(tx, created.id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function updateUnitConversion(
  actor: AuthContext,
  id: string,
  input: UpdateUnitConversionInput,
  externalTx?: Tx,
) {
  assertCan(actor, "inventory.units.manage");

  const run = async (tx: Tx) => {
    const current = await requireConversion(tx, id);
    const next = {
      ratio: input.ratio ?? current.ratio,
      note: input.note === undefined ? current.note : input.note,
    };

    await tx
      .update(unitConversions)
      .set({ ...next, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(unitConversions.id, id));

    await audit.log(
      {
        action: "unit_conversion.update",
        entityType: "unit_conversion",
        entityId: id,
        actorId: actor.userId,
        before: { ratio: current.ratio, note: current.note },
        after: next,
      },
      tx,
    );
    return requireConversion(tx, id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}
