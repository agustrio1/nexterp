import { asc, eq } from "drizzle-orm";

import { assetCategories } from "@/db/schema";
import type { CreateCategoryInput, UpdateCategoryInput } from "@/modules/assets/schemas";
import { assertCan, inTx, requireCategory, type Reader, type Tx } from "@/modules/assets/_refs";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { conflict } from "@/server/errors";
import type { AuthContext } from "@/server/authz";

const columns = {
  id: assetCategories.id,
  code: assetCategories.code,
  name: assetCategories.name,
  depreciationMethod: assetCategories.depreciationMethod,
  usefulLifeMonths: assetCategories.usefulLifeMonths,
  residualPercent: assetCategories.residualPercent,
  decliningRatePercent: assetCategories.decliningRatePercent,
  totalUnits: assetCategories.totalUnits,
  assetCostAccountId: assetCategories.assetCostAccountId,
  accumulatedDepreciationAccountId: assetCategories.accumulatedDepreciationAccountId,
  depreciationExpenseAccountId: assetCategories.depreciationExpenseAccountId,
  isActive: assetCategories.isActive,
  createdAt: assetCategories.createdAt,
  updatedAt: assetCategories.updatedAt,
};

export async function listCategories(
  actor: AuthContext,
  query: { isActive?: boolean } = {},
  externalTx?: Tx,
) {
  assertCan(actor, "assets.categories.read");
  const reader: Reader = externalTx ?? db;
  return reader
    .select(columns)
    .from(assetCategories)
    .where(query.isActive === undefined ? undefined : eq(assetCategories.isActive, query.isActive))
    .orderBy(asc(assetCategories.code));
}

export async function getCategory(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "assets.categories.read");
  return requireCategory(externalTx ?? db, id);
}

export async function createCategory(actor: AuthContext, input: CreateCategoryInput, externalTx?: Tx) {
  assertCan(actor, "assets.categories.manage");
  return inTx(externalTx, async (tx) => {
    const [existing] = await tx
      .select({ id: assetCategories.id })
      .from(assetCategories)
      .where(eq(assetCategories.code, input.code))
      .limit(1);
    if (existing) throw conflict("Kode kategori sudah dipakai.");

    const [created] = await tx
      .insert(assetCategories)
      .values({
        code: input.code,
        name: input.name,
        depreciationMethod: input.depreciationMethod,
        usefulLifeMonths: input.usefulLifeMonths,
        residualPercent: input.residualPercent,
        decliningRatePercent: input.decliningRatePercent ?? null,
        totalUnits: input.totalUnits ?? null,
        assetCostAccountId: input.assetCostAccountId ?? null,
        accumulatedDepreciationAccountId: input.accumulatedDepreciationAccountId ?? null,
        depreciationExpenseAccountId: input.depreciationExpenseAccountId ?? null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: assetCategories.id });
    if (!created) throw new Error("Gagal membuat kategori aset.");
    await audit.log(
      {
        action: "assets.category.create",
        entityType: "asset_category",
        entityId: created.id,
        actorId: actor.userId,
        after: { code: input.code, name: input.name, depreciationMethod: input.depreciationMethod },
      },
      tx,
    );
    return requireCategory(tx, created.id);
  });
}

export async function updateCategory(
  actor: AuthContext,
  id: string,
  input: UpdateCategoryInput,
  externalTx?: Tx,
) {
  assertCan(actor, "assets.categories.manage");
  return inTx(externalTx, async (tx) => {
    const current = await requireCategory(tx, id);
    const next = {
      name: input.name ?? current.name,
      depreciationMethod: input.depreciationMethod ?? current.depreciationMethod,
      usefulLifeMonths: input.usefulLifeMonths ?? current.usefulLifeMonths,
      residualPercent: input.residualPercent ?? current.residualPercent,
      decliningRatePercent:
        input.decliningRatePercent === undefined ? current.decliningRatePercent : input.decliningRatePercent,
      totalUnits: input.totalUnits === undefined ? current.totalUnits : input.totalUnits,
      assetCostAccountId:
        input.assetCostAccountId === undefined ? current.assetCostAccountId : input.assetCostAccountId,
      accumulatedDepreciationAccountId:
        input.accumulatedDepreciationAccountId === undefined
          ? current.accumulatedDepreciationAccountId
          : input.accumulatedDepreciationAccountId,
      depreciationExpenseAccountId:
        input.depreciationExpenseAccountId === undefined
          ? current.depreciationExpenseAccountId
          : input.depreciationExpenseAccountId,
      isActive: input.isActive ?? current.isActive,
    };
    await tx
      .update(assetCategories)
      .set({ ...next, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(assetCategories.id, id));
    await audit.log(
      { action: "assets.category.update", entityType: "asset_category", entityId: id, actorId: actor.userId, after: next },
      tx,
    );
    return requireCategory(tx, id);
  });
}
