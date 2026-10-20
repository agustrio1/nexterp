import { and, desc, eq } from "drizzle-orm";

import { assetAcquisitions, bankAccounts, fixedAssets } from "@/db/schema";
import type { CreateAcquisitionInput, UpdateAcquisitionInput } from "@/modules/assets/schemas";
import {
  assertCan,
  inTx,
  lockAcquisition,
  requireAcquisition,
  requireActiveCategory,
  requireLiveAsset,
  type Reader,
  type Tx,
} from "@/modules/assets/_refs";
import { buildAcquisitionJournalLines } from "@/modules/assets/journal-builder";
import {
  resolveAssetPayableAccountId,
  resolveEffectiveAssetAccounts,
} from "@/modules/assets/asset-account-config";
import {
  createSystemDraft,
  postJournal,
  reverseJournal,
} from "@/modules/accounting/journal-service";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { businessRule, conflict, notFound } from "@/server/errors";
import { nextDocumentNumber } from "@/server/numbering";
import { add, sub, toDb } from "@/lib/money";
import type { AuthContext } from "@/server/authz";

const SOURCE_ACQUISITION = "asset_acquisition";

const columns = {
  id: assetAcquisitions.id,
  docNo: assetAcquisitions.docNo,
  assetId: assetAcquisitions.assetId,
  acquisitionDate: assetAcquisitions.acquisitionDate,
  amount: assetAcquisitions.amount,
  fundingSource: assetAcquisitions.fundingSource,
  bankAccountId: assetAcquisitions.bankAccountId,
  journalEntryId: assetAcquisitions.journalEntryId,
  status: assetAcquisitions.status,
  reason: assetAcquisitions.reason,
  notes: assetAcquisitions.notes,
  createdAt: assetAcquisitions.createdAt,
  updatedAt: assetAcquisitions.updatedAt,
};

async function withAsset(reader: Reader, id: string) {
  const [row] = await reader
    .select({ ...columns, assetCode: fixedAssets.code, assetName: fixedAssets.name })
    .from(assetAcquisitions)
    .innerJoin(fixedAssets, eq(fixedAssets.id, assetAcquisitions.assetId))
    .where(eq(assetAcquisitions.id, id))
    .limit(1);
  if (!row) throw notFound("Akuisisi aset tidak ditemukan.");
  return row;
}

/** Selesaikan akun kredit sumber dana akuisisi (bank/kas -> rekening, utang -> config). */
async function resolveFundingAccountId(tx: Tx, acq: { fundingSource: string; bankAccountId: string | null }) {
  if (acq.fundingSource === "payable") {
    const id = await resolveAssetPayableAccountId(tx, true);
    if (!id) throw businessRule("Akun utang aset belum diatur.");
    return id;
  }
  if (!acq.bankAccountId) throw businessRule("Akuisisi bank/kas wajib memilih rekening bank.");
  const [bank] = await tx
    .select({ accountId: bankAccounts.accountId, isActive: bankAccounts.isActive })
    .from(bankAccounts)
    .where(eq(bankAccounts.id, acq.bankAccountId))
    .limit(1);
  if (!bank) throw notFound("Rekening bank tidak ditemukan.");
  if (!bank.isActive) throw conflict("Rekening bank tidak aktif.");
  return bank.accountId;
}

export async function listAcquisitions(
  actor: AuthContext,
  query: { assetId?: string; status?: string } = {},
  externalTx?: Tx,
) {
  assertCan(actor, "assets.acquisitions.read");
  const reader: Reader = externalTx ?? db;
  return reader
    .select(columns)
    .from(assetAcquisitions)
    .where(
      and(
        query.assetId ? eq(assetAcquisitions.assetId, query.assetId) : undefined,
        query.status ? eq(assetAcquisitions.status, query.status as never) : undefined,
      ),
    )
    .orderBy(desc(assetAcquisitions.createdAt));
}

export async function getAcquisition(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "assets.acquisitions.read");
  return withAsset(externalTx ?? db, id);
}

export async function createAcquisition(actor: AuthContext, input: CreateAcquisitionInput, externalTx?: Tx) {
  assertCan(actor, "assets.acquisitions.manage");
  return inTx(externalTx, async (tx) => {
    await requireLiveAsset(tx, input.assetId);
    const [created] = await tx
      .insert(assetAcquisitions)
      .values({
        assetId: input.assetId,
        acquisitionDate: input.acquisitionDate,
        amount: input.amount,
        fundingSource: input.fundingSource,
        bankAccountId: input.bankAccountId ?? null,
        status: "draft",
        notes: input.notes ?? null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: assetAcquisitions.id });
    if (!created) throw new Error("Gagal membuat akuisisi.");
    await audit.log(
      {
        action: "assets.acquisition.create",
        entityType: "asset_acquisition",
        entityId: created.id,
        actorId: actor.userId,
        after: { assetId: input.assetId, amount: input.amount, fundingSource: input.fundingSource },
      },
      tx,
    );
    return withAsset(tx, created.id);
  });
}

export async function updateAcquisition(
  actor: AuthContext,
  id: string,
  input: UpdateAcquisitionInput,
  externalTx?: Tx,
) {
  assertCan(actor, "assets.acquisitions.manage");
  return inTx(externalTx, async (tx) => {
    const current = await requireAcquisition(tx, id);
    if (current.status !== "draft") throw businessRule("Hanya akuisisi draft yang dapat diubah.");
    const next = {
      acquisitionDate: input.acquisitionDate ?? current.acquisitionDate,
      amount: input.amount ?? current.amount,
      fundingSource: input.fundingSource ?? current.fundingSource,
      bankAccountId: input.bankAccountId === undefined ? current.bankAccountId : input.bankAccountId,
      notes: input.notes === undefined ? current.notes : input.notes,
    };
    await tx
      .update(assetAcquisitions)
      .set({ ...next, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(assetAcquisitions.id, id));
    await audit.log(
      { action: "assets.acquisition.update", entityType: "asset_acquisition", entityId: id, actorId: actor.userId, after: next },
      tx,
    );
    return withAsset(tx, id);
  });
}

export async function postAcquisition(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "assets.acquisitions.post");
  return inTx(externalTx, async (tx) => {
    const acq = await lockAcquisition(tx, id);
    if (acq.status !== "draft") throw businessRule("Hanya akuisisi berstatus draft yang dapat diposting.");
    const asset = await requireLiveAsset(tx, acq.assetId);
    const category = await requireActiveCategory(tx, asset.categoryId);

    const accounts = await resolveEffectiveAssetAccounts(tx, category);
    const fundingAccountId = await resolveFundingAccountId(tx, acq);
    const lines = buildAcquisitionJournalLines(
      { assetCostAccountId: accounts.assetCostAccountId, fundingAccountId },
      acq.amount,
    );

    const draft = await createSystemDraft(tx, actor, {
      entryDate: acq.acquisitionDate,
      description: `Akuisisi aset ${asset.code}`,
      lines,
      sourceType: SOURCE_ACQUISITION,
      sourceId: acq.id,
      sourceEvent: "post",
      idempotencyKey: `asset_acquisition_post:${acq.id}`,
    });
    const posted = await postJournal(actor, draft.id, tx);

    const docNo = await nextDocumentNumber(tx, "asset_acquisition", { date: acq.acquisitionDate });

    await tx
      .update(assetAcquisitions)
      .set({ status: "posted", docNo, journalEntryId: posted.id, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(assetAcquisitions.id, id));

    // Naikkan harga perolehan register (akumulasi kapitalisasi).
    await tx
      .update(fixedAssets)
      .set({
        cost: toDb(add(asset.cost, acq.amount)),
        status: asset.status === "draft" ? "active" : asset.status,
        updatedBy: actor.userId,
        updatedAt: new Date(),
      })
      .where(eq(fixedAssets.id, asset.id));

    await audit.log(
      { action: "assets.acquisition.post", entityType: "asset_acquisition", entityId: id, actorId: actor.userId, after: { status: "posted", docNo, journalEntryId: posted.id } },
      tx,
    );
    return withAsset(tx, id);
  });
}

export async function cancelAcquisition(actor: AuthContext, id: string, reason: string, externalTx?: Tx) {
  assertCan(actor, "assets.acquisitions.manage");
  return inTx(externalTx, async (tx) => {
    const acq = await lockAcquisition(tx, id);
    if (acq.status !== "draft") throw businessRule("Hanya akuisisi draft yang dapat dibatalkan.");
    await tx
      .update(assetAcquisitions)
      .set({ status: "cancelled", reason, cancelledAt: new Date(), updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(assetAcquisitions.id, id));
    await audit.log(
      { action: "assets.acquisition.cancel", entityType: "asset_acquisition", entityId: id, actorId: actor.userId, after: { status: "cancelled", reason } },
      tx,
    );
    return withAsset(tx, id);
  });
}

export async function reverseAcquisition(actor: AuthContext, id: string, reason: string, externalTx?: Tx) {
  assertCan(actor, "assets.acquisitions.post");
  return inTx(externalTx, async (tx) => {
    const acq = await lockAcquisition(tx, id);
    if (acq.status !== "posted") throw businessRule("Hanya akuisisi posted yang dapat dibalik.");
    if (!acq.journalEntryId) throw businessRule("Akuisisi posted tanpa jurnal terkait; tidak dapat dibalik.");

    await reverseJournal(actor, acq.journalEntryId, { reason }, tx);

    // Kurangi kembali harga perolehan register.
    const [a] = await tx.select({ cost: fixedAssets.cost }).from(fixedAssets).where(eq(fixedAssets.id, acq.assetId)).limit(1);
    if (a) {
      await tx
        .update(fixedAssets)
        .set({ cost: toDb(sub(a.cost, acq.amount)), updatedBy: actor.userId, updatedAt: new Date() })
        .where(eq(fixedAssets.id, acq.assetId));
    }

    await tx
      .update(assetAcquisitions)
      .set({ status: "reversed", reason, reversedAt: new Date(), updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(assetAcquisitions.id, id));
    await audit.log(
      { action: "assets.acquisition.reverse", entityType: "asset_acquisition", entityId: id, actorId: actor.userId, after: { status: "reversed", reason } },
      tx,
    );
    return withAsset(tx, id);
  });
}
