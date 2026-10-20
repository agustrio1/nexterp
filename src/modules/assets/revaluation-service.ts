import { desc, eq } from "drizzle-orm";

import { assetRevaluations, fixedAssets } from "@/db/schema";
import type { CreateRevaluationInput } from "@/modules/assets/schemas";
import {
  assertCan,
  inTx,
  lockRevaluation,
  requireActiveCategory,
  requireLiveAsset,
  type Reader,
  type Tx,
} from "@/modules/assets/_refs";
import { buildRevaluationJournalLines } from "@/modules/assets/journal-builder";
import {
  resolveDisposalAccountIds,
  resolveEffectiveAssetAccounts,
} from "@/modules/assets/asset-account-config";
import { createSystemDraft, postJournal } from "@/modules/accounting/journal-service";
import { cmp, sub, toDb } from "@/lib/money";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { businessRule, notFound } from "@/server/errors";
import { nextDocumentNumber } from "@/server/numbering";
import type { AuthContext } from "@/server/authz";

const SOURCE_REVALUATION = "asset_revaluation";

const columns = {
  id: assetRevaluations.id,
  docNo: assetRevaluations.docNo,
  assetId: assetRevaluations.assetId,
  effectiveDate: assetRevaluations.effectiveDate,
  newCost: assetRevaluations.newCost,
  newAccumulated: assetRevaluations.newAccumulated,
  journalEntryId: assetRevaluations.journalEntryId,
  status: assetRevaluations.status,
  notes: assetRevaluations.notes,
  createdAt: assetRevaluations.createdAt,
  updatedAt: assetRevaluations.updatedAt,
};

async function withAsset(reader: Reader, id: string) {
  const [row] = await reader
    .select({ ...columns, assetCode: fixedAssets.code, assetName: fixedAssets.name })
    .from(assetRevaluations)
    .innerJoin(fixedAssets, eq(fixedAssets.id, assetRevaluations.assetId))
    .where(eq(assetRevaluations.id, id))
    .limit(1);
  if (!row) throw notFound("Revaluasi aset tidak ditemukan.");
  return row;
}

export async function listRevaluations(actor: AuthContext, assetId?: string, externalTx?: Tx) {
  assertCan(actor, "assets.register.read");
  const reader: Reader = externalTx ?? db;
  return reader
    .select(columns)
    .from(assetRevaluations)
    .where(assetId ? eq(assetRevaluations.assetId, assetId) : undefined)
    .orderBy(desc(assetRevaluations.createdAt));
}

export async function getRevaluation(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "assets.register.read");
  return withAsset(externalTx ?? db, id);
}

export async function createRevaluation(actor: AuthContext, input: CreateRevaluationInput, externalTx?: Tx) {
  assertCan(actor, "assets.revaluation.manage");
  return inTx(externalTx, async (tx) => {
    await requireLiveAsset(tx, input.assetId);
    const [created] = await tx
      .insert(assetRevaluations)
      .values({
        assetId: input.assetId,
        effectiveDate: input.effectiveDate,
        newCost: input.newCost,
        newAccumulated: input.newAccumulated,
        status: "draft",
        notes: input.notes ?? null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: assetRevaluations.id });
    if (!created) throw new Error("Gagal membuat revaluasi.");
    await audit.log(
      { action: "assets.revaluation.create", entityType: "asset_revaluation", entityId: created.id, actorId: actor.userId, after: { assetId: input.assetId, newCost: input.newCost, newAccumulated: input.newAccumulated } },
      tx,
    );
    return withAsset(tx, created.id);
  });
}

/**
 * Post revaluasi minimal: jurnal selisih biaya/akumulasi ke laba/rugi, lalu
 * register disesuaikan ke nilai baru. Tidak ada reversal (di luar cakupan minimal).
 */
export async function postRevaluation(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "assets.revaluation.manage");
  return inTx(externalTx, async (tx) => {
    const reval = await lockRevaluation(tx, id);
    if (reval.status !== "draft") throw businessRule("Hanya revaluasi berstatus draft yang dapat diposting.");
    const asset = await requireLiveAsset(tx, reval.assetId);
    const category = await requireActiveCategory(tx, asset.categoryId);

    const figures = {
      oldCost: toDb(asset.cost),
      oldAccumulated: toDb(asset.accumulatedDepreciation),
      newCost: toDb(reval.newCost),
      newAccumulated: toDb(reval.newAccumulated),
    };
    const noChange =
      cmp(sub(figures.newCost, figures.oldCost), "0") === 0 &&
      cmp(sub(figures.newAccumulated, figures.oldAccumulated), "0") === 0;
    if (noChange) throw businessRule("Revaluasi tidak mengubah nilai apa pun.");

    const assetAccounts = await resolveEffectiveAssetAccounts(tx, category);
    const pnlAccounts = await resolveDisposalAccountIds(tx);
    const lines = buildRevaluationJournalLines(
      {
        assetCostAccountId: assetAccounts.assetCostAccountId,
        accumulatedDepreciationAccountId: assetAccounts.accumulatedDepreciationAccountId,
        disposalLossAccountId: pnlAccounts.disposalLossAccountId,
        disposalGainAccountId: pnlAccounts.disposalGainAccountId,
      },
      figures,
    );

    const draft = await createSystemDraft(tx, actor, {
      entryDate: reval.effectiveDate,
      description: `Revaluasi aset ${asset.code}`,
      lines,
      sourceType: SOURCE_REVALUATION,
      sourceId: reval.id,
      sourceEvent: "post",
      idempotencyKey: `asset_revaluation_post:${reval.id}`,
    });
    const posted = await postJournal(actor, draft.id, tx);
    const docNo = await nextDocumentNumber(tx, "asset_revaluation", { date: reval.effectiveDate });

    await tx
      .update(assetRevaluations)
      .set({ status: "posted", docNo, journalEntryId: posted.id, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(assetRevaluations.id, id));

    await tx
      .update(fixedAssets)
      .set({ cost: figures.newCost, accumulatedDepreciation: figures.newAccumulated, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(fixedAssets.id, asset.id));

    await audit.log(
      { action: "assets.revaluation.post", entityType: "asset_revaluation", entityId: id, actorId: actor.userId, after: { status: "posted", docNo, newCost: figures.newCost, newAccumulated: figures.newAccumulated } },
      tx,
    );
    return withAsset(tx, id);
  });
}
