import { and, desc, eq } from "drizzle-orm";

import { assetDisposals, bankAccounts, fixedAssets } from "@/db/schema";
import type { CreateDisposalInput } from "@/modules/assets/schemas";
import {
  assertCan,
  inTx,
  lockDisposal,
  requireActiveCategory,
  requireLiveAsset,
  type Reader,
  type Tx,
} from "@/modules/assets/_refs";
import { buildDisposalJournalLines, disposalGainLoss } from "@/modules/assets/journal-builder";
import {
  resolveDisposalAccountIds,
  resolveEffectiveAssetAccounts,
} from "@/modules/assets/asset-account-config";
import { createSystemDraft, postJournal, reverseJournal } from "@/modules/accounting/journal-service";
import { cmp, toDb } from "@/lib/money";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { businessRule, conflict, notFound } from "@/server/errors";
import { nextDocumentNumber } from "@/server/numbering";
import type { AuthContext } from "@/server/authz";

const SOURCE_DISPOSAL = "asset_disposal";

const columns = {
  id: assetDisposals.id,
  docNo: assetDisposals.docNo,
  assetId: assetDisposals.assetId,
  disposalDate: assetDisposals.disposalDate,
  proceedsAmount: assetDisposals.proceedsAmount,
  costRemoved: assetDisposals.costRemoved,
  accumulatedRemoved: assetDisposals.accumulatedRemoved,
  gainAmount: assetDisposals.gainAmount,
  lossAmount: assetDisposals.lossAmount,
  bankAccountId: assetDisposals.bankAccountId,
  journalEntryId: assetDisposals.journalEntryId,
  status: assetDisposals.status,
  reason: assetDisposals.reason,
  notes: assetDisposals.notes,
  createdAt: assetDisposals.createdAt,
  updatedAt: assetDisposals.updatedAt,
};

async function withAsset(reader: Reader, id: string) {
  const [row] = await reader
    .select({ ...columns, assetCode: fixedAssets.code, assetName: fixedAssets.name })
    .from(assetDisposals)
    .innerJoin(fixedAssets, eq(fixedAssets.id, assetDisposals.assetId))
    .where(eq(assetDisposals.id, id))
    .limit(1);
  if (!row) throw notFound("Pelepasan aset tidak ditemukan.");
  return row;
}

export async function listDisposals(actor: AuthContext, query: { assetId?: string; status?: string } = {}, externalTx?: Tx) {
  assertCan(actor, "assets.disposal.read");
  const reader: Reader = externalTx ?? db;
  return reader
    .select(columns)
    .from(assetDisposals)
    .where(
      and(
        query.assetId ? eq(assetDisposals.assetId, query.assetId) : undefined,
        query.status ? eq(assetDisposals.status, query.status as never) : undefined,
      ),
    )
    .orderBy(desc(assetDisposals.createdAt));
}

export async function getDisposal(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "assets.disposal.read");
  return withAsset(externalTx ?? db, id);
}

export async function createDisposal(actor: AuthContext, input: CreateDisposalInput, externalTx?: Tx) {
  assertCan(actor, "assets.disposal.manage");
  return inTx(externalTx, async (tx) => {
    const asset = await requireLiveAsset(tx, input.assetId);
    const [created] = await tx
      .insert(assetDisposals)
      .values({
        assetId: input.assetId,
        disposalDate: input.disposalDate,
        proceedsAmount: input.proceedsAmount,
        costRemoved: asset.cost,
        accumulatedRemoved: asset.accumulatedDepreciation,
        bankAccountId: input.bankAccountId ?? null,
        status: "draft",
        notes: input.notes ?? null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: assetDisposals.id });
    if (!created) throw new Error("Gagal membuat pelepasan.");
    await audit.log(
      { action: "assets.disposal.create", entityType: "asset_disposal", entityId: created.id, actorId: actor.userId, after: { assetId: input.assetId, proceedsAmount: input.proceedsAmount } },
      tx,
    );
    return withAsset(tx, created.id);
  });
}

export async function postDisposal(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "assets.disposal.post");
  return inTx(externalTx, async (tx) => {
    const disposal = await lockDisposal(tx, id);
    if (disposal.status !== "draft") throw businessRule("Hanya pelepasan berstatus draft yang dapat diposting.");
    const asset = await requireLiveAsset(tx, disposal.assetId);
    const category = await requireActiveCategory(tx, asset.categoryId);

    // Snapshot nilai berjalan sebagai angka resmi pelepasan.
    const costRemoved = toDb(asset.cost);
    const accumulatedRemoved = toDb(asset.accumulatedDepreciation);
    const figures = { costRemoved, accumulatedRemoved, proceeds: toDb(disposal.proceedsAmount) };
    const gl = disposalGainLoss(figures);

    let proceedsAccountId: string | null = null;
    if (cmp(figures.proceeds, "0") > 0) {
      if (!disposal.bankAccountId) throw businessRule("Pelepasan dengan hasil penjualan wajib memilih rekening bank.");
      const [bank] = await tx
        .select({ accountId: bankAccounts.accountId, isActive: bankAccounts.isActive })
        .from(bankAccounts)
        .where(eq(bankAccounts.id, disposal.bankAccountId))
        .limit(1);
      if (!bank) throw notFound("Rekening bank tidak ditemukan.");
      if (!bank.isActive) throw conflict("Rekening bank tidak aktif.");
      proceedsAccountId = bank.accountId;
    }

    const assetAccounts = await resolveEffectiveAssetAccounts(tx, category);
    const pnlAccounts = await resolveDisposalAccountIds(tx);
    const lines = buildDisposalJournalLines(
      {
        assetCostAccountId: assetAccounts.assetCostAccountId,
        accumulatedDepreciationAccountId: assetAccounts.accumulatedDepreciationAccountId,
        proceedsAccountId,
        disposalLossAccountId: pnlAccounts.disposalLossAccountId,
        disposalGainAccountId: pnlAccounts.disposalGainAccountId,
      },
      figures,
    );

    const draft = await createSystemDraft(tx, actor, {
      entryDate: disposal.disposalDate,
      description: `Pelepasan aset ${asset.code}`,
      lines,
      sourceType: SOURCE_DISPOSAL,
      sourceId: disposal.id,
      sourceEvent: "post",
      idempotencyKey: `asset_disposal_post:${disposal.id}`,
    });
    const posted = await postJournal(actor, draft.id, tx);
    const docNo = await nextDocumentNumber(tx, "asset_disposal", { date: disposal.disposalDate });

    await tx
      .update(assetDisposals)
      .set({
        status: "posted",
        docNo,
        journalEntryId: posted.id,
        costRemoved,
        accumulatedRemoved,
        gainAmount: gl.gain,
        lossAmount: gl.loss,
        updatedBy: actor.userId,
        updatedAt: new Date(),
      })
      .where(eq(assetDisposals.id, id));

    await tx
      .update(fixedAssets)
      .set({ status: "disposed", isActive: false, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(fixedAssets.id, asset.id));

    await audit.log(
      { action: "assets.disposal.post", entityType: "asset_disposal", entityId: id, actorId: actor.userId, after: { status: "posted", docNo, gainAmount: gl.gain, lossAmount: gl.loss } },
      tx,
    );
    return withAsset(tx, id);
  });
}

export async function reverseDisposal(actor: AuthContext, id: string, reason: string, externalTx?: Tx) {
  assertCan(actor, "assets.disposal.post");
  return inTx(externalTx, async (tx) => {
    const disposal = await lockDisposal(tx, id);
    if (disposal.status !== "posted") throw businessRule("Hanya pelepasan posted yang dapat dibalik.");
    if (!disposal.journalEntryId) throw businessRule("Pelepasan posted tanpa jurnal terkait; tidak dapat dibalik.");

    await reverseJournal(actor, disposal.journalEntryId, { reason }, tx);

    await tx
      .update(fixedAssets)
      .set({ status: "active", isActive: true, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(fixedAssets.id, disposal.assetId));

    await tx
      .update(assetDisposals)
      .set({ status: "reversed", reason, reversedAt: new Date(), updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(assetDisposals.id, id));
    await audit.log(
      { action: "assets.disposal.reverse", entityType: "asset_disposal", entityId: id, actorId: actor.userId, after: { status: "reversed", reason } },
      tx,
    );
    return withAsset(tx, id);
  });
}
