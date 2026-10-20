import { asc, eq, and } from "drizzle-orm";

import { assetCategories, assetUsageEntries, fixedAssets, type AssetStatus } from "@/db/schema";
import type { CreateAssetInput, UpsertUsageInput, UpdateAssetInput } from "@/modules/assets/schemas";
import {
  assertCan,
  inTx,
  requireActiveCategory,
  requireAsset,
  type Reader,
  type Tx,
} from "@/modules/assets/_refs";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { conflict } from "@/server/errors";
import type { AuthContext } from "@/server/authz";

const columns = {
  id: fixedAssets.id,
  code: fixedAssets.code,
  name: fixedAssets.name,
  categoryId: fixedAssets.categoryId,
  branchId: fixedAssets.branchId,
  departmentId: fixedAssets.departmentId,
  costCenterId: fixedAssets.costCenterId,
  location: fixedAssets.location,
  inServiceDate: fixedAssets.inServiceDate,
  cost: fixedAssets.cost,
  accumulatedDepreciation: fixedAssets.accumulatedDepreciation,
  residualValue: fixedAssets.residualValue,
  usefulLifeMonths: fixedAssets.usefulLifeMonths,
  depreciationMethod: fixedAssets.depreciationMethod,
  decliningRatePercent: fixedAssets.decliningRatePercent,
  totalUnits: fixedAssets.totalUnits,
  unitsPeriod: fixedAssets.unitsPeriod,
  status: fixedAssets.status,
  isActive: fixedAssets.isActive,
  notes: fixedAssets.notes,
  createdAt: fixedAssets.createdAt,
  updatedAt: fixedAssets.updatedAt,
};

async function assetWithCategory(reader: Reader, id: string) {
  const [row] = await reader
    .select({ ...columns, categoryCode: assetCategories.code, categoryName: assetCategories.name })
    .from(fixedAssets)
    .innerJoin(assetCategories, eq(assetCategories.id, fixedAssets.categoryId))
    .where(eq(fixedAssets.id, id))
    .limit(1);
  if (!row) throw conflict("Aset tidak ditemukan.");
  return row;
}

export async function listAssets(
  actor: AuthContext,
  query: {
    categoryId?: string;
    branchId?: string;
    status?: AssetStatus;
    isActive?: boolean;
  } = {},
  externalTx?: Tx,
) {
  assertCan(actor, "assets.register.read");
  const reader: Reader = externalTx ?? db;
  return reader
    .select({ ...columns, categoryCode: assetCategories.code })
    .from(fixedAssets)
    .innerJoin(assetCategories, eq(assetCategories.id, fixedAssets.categoryId))
    .where(
      and(
        query.categoryId ? eq(fixedAssets.categoryId, query.categoryId) : undefined,
        query.branchId ? eq(fixedAssets.branchId, query.branchId) : undefined,
        query.status ? eq(fixedAssets.status, query.status) : undefined,
        query.isActive === undefined ? undefined : eq(fixedAssets.isActive, query.isActive),
      ),
    )
    .orderBy(asc(fixedAssets.code));
}

export async function getAsset(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "assets.register.read");
  return assetWithCategory(externalTx ?? db, id);
}

export async function createAsset(actor: AuthContext, input: CreateAssetInput, externalTx?: Tx) {
  assertCan(actor, "assets.register.manage");
  return inTx(externalTx, async (tx) => {
    await requireActiveCategory(tx, input.categoryId);
    const [existing] = await tx
      .select({ id: fixedAssets.id })
      .from(fixedAssets)
      .where(eq(fixedAssets.code, input.code))
      .limit(1);
    if (existing) throw conflict("Kode aset sudah dipakai.");

    const [created] = await tx
      .insert(fixedAssets)
      .values({
        code: input.code,
        name: input.name,
        categoryId: input.categoryId,
        branchId: input.branchId ?? null,
        departmentId: input.departmentId ?? null,
        costCenterId: input.costCenterId ?? null,
        location: input.location ?? null,
        inServiceDate: input.inServiceDate,
        cost: input.cost,
        residualValue: input.residualValue ?? null,
        usefulLifeMonths: input.usefulLifeMonths ?? null,
        depreciationMethod: input.depreciationMethod ?? null,
        decliningRatePercent: input.decliningRatePercent ?? null,
        totalUnits: input.totalUnits ?? null,
        unitsPeriod: input.unitsPeriod ?? null,
        status: input.status,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: fixedAssets.id });
    if (!created) throw new Error("Gagal membuat aset.");
    await audit.log(
      {
        action: "assets.asset.create",
        entityType: "fixed_asset",
        entityId: created.id,
        actorId: actor.userId,
        after: { code: input.code, name: input.name, cost: input.cost, status: input.status },
      },
      tx,
    );
    return assetWithCategory(tx, created.id);
  });
}

export async function updateAsset(
  actor: AuthContext,
  id: string,
  input: UpdateAssetInput,
  externalTx?: Tx,
) {
  assertCan(actor, "assets.register.manage");
  return inTx(externalTx, async (tx) => {
    const current = await requireAsset(tx, id);
    if (current.status === "disposed") throw conflict("Aset sudah dilepas; tidak dapat diubah.");
    const next = {
      name: input.name ?? current.name,
      branchId: input.branchId === undefined ? current.branchId : input.branchId,
      departmentId: input.departmentId === undefined ? current.departmentId : input.departmentId,
      costCenterId: input.costCenterId === undefined ? current.costCenterId : input.costCenterId,
      location: input.location === undefined ? current.location : input.location,
      inServiceDate: input.inServiceDate ?? current.inServiceDate,
      residualValue: input.residualValue === undefined ? current.residualValue : input.residualValue,
      usefulLifeMonths: input.usefulLifeMonths === undefined ? current.usefulLifeMonths : input.usefulLifeMonths,
      depreciationMethod:
        input.depreciationMethod === undefined ? current.depreciationMethod : input.depreciationMethod,
      decliningRatePercent:
        input.decliningRatePercent === undefined ? current.decliningRatePercent : input.decliningRatePercent,
      totalUnits: input.totalUnits === undefined ? current.totalUnits : input.totalUnits,
      unitsPeriod: input.unitsPeriod === undefined ? current.unitsPeriod : input.unitsPeriod,
      status: input.status ?? current.status,
      isActive: input.isActive ?? current.isActive,
      notes: input.notes === undefined ? current.notes : input.notes,
    };
    await tx
      .update(fixedAssets)
      .set({ ...next, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(fixedAssets.id, id));
    await audit.log(
      { action: "assets.asset.update", entityType: "fixed_asset", entityId: id, actorId: actor.userId, after: next },
      tx,
    );
    return assetWithCategory(tx, id);
  });
}

/* ------------------------------ Usage ------------------------------ */

export async function listUsage(actor: AuthContext, assetId: string, externalTx?: Tx) {
  assertCan(actor, "assets.register.read");
  const reader: Reader = externalTx ?? db;
  await requireAsset(reader, assetId);
  return reader
    .select()
    .from(assetUsageEntries)
    .where(eq(assetUsageEntries.assetId, assetId))
    .orderBy(asc(assetUsageEntries.periodKey));
}

/** Catat/ubah pemakaian satuan sebuah aset untuk satu periode (units_of_production). */
export async function upsertUsage(actor: AuthContext, assetId: string, input: UpsertUsageInput, externalTx?: Tx) {
  assertCan(actor, "assets.register.manage");
  return inTx(externalTx, async (tx) => {
    await requireAsset(tx, assetId);
    const [row] = await tx
      .insert(assetUsageEntries)
      .values({
        assetId,
        periodKey: input.periodKey,
        units: input.units,
        notes: input.notes ?? null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .onConflictDoUpdate({
        target: [assetUsageEntries.assetId, assetUsageEntries.periodKey],
        set: { units: input.units, notes: input.notes ?? null, updatedBy: actor.userId, updatedAt: new Date() },
      })
      .returning();
    await audit.log(
      {
        action: "assets.usage.upsert",
        entityType: "asset_usage_entry",
        entityId: row?.id ?? null,
        actorId: actor.userId,
        after: { assetId, periodKey: input.periodKey, units: input.units },
      },
      tx,
    );
    return row;
  });
}
