import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

import {
  assetCategories,
  assetDepreciationRunItems,
  assetDepreciationRuns,
  assetDepreciationSchedules,
  assetUsageEntries,
  fixedAssets,
  type DepreciationMethod,
} from "@/db/schema";
import type { CreateRunInput } from "@/modules/assets/schemas";
import {
  assertCan,
  inTx,
  lockRun,
  periodKeyOf,
  requireAccountingPeriod,
  requireRun,
  type Reader,
  type Tx,
} from "@/modules/assets/_refs";
import { computePeriodDepreciation, resolveDepreciationParams } from "@/modules/assets/depreciation";
import { buildDepreciationJournalLines } from "@/modules/assets/journal-builder";
import { resolveAssetAccountIds } from "@/modules/assets/asset-account-config";
import { createSystemDraft, postJournal, reverseJournal } from "@/modules/accounting/journal-service";
import { add, cmp, sub, toDb } from "@/lib/money";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { businessRule } from "@/server/errors";
import { nextDocumentNumber } from "@/server/numbering";
import type { AuthContext } from "@/server/authz";

const SOURCE_DEPRECIATION = "asset_depreciation";

const runColumns = {
  id: assetDepreciationRuns.id,
  docNo: assetDepreciationRuns.docNo,
  periodId: assetDepreciationRuns.periodId,
  branchId: assetDepreciationRuns.branchId,
  status: assetDepreciationRuns.status,
  assetCount: assetDepreciationRuns.assetCount,
  totalDepreciation: assetDepreciationRuns.totalDepreciation,
  journalEntryId: assetDepreciationRuns.journalEntryId,
  calculatedBy: assetDepreciationRuns.calculatedBy,
  approvedBy: assetDepreciationRuns.approvedBy,
  postedAt: assetDepreciationRuns.postedAt,
  cancelledAt: assetDepreciationRuns.cancelledAt,
  reversedAt: assetDepreciationRuns.reversedAt,
  reason: assetDepreciationRuns.reason,
  createdAt: assetDepreciationRuns.createdAt,
  updatedAt: assetDepreciationRuns.updatedAt,
};

const DEPRECIABLE_STATUSES = ["active", "idle", "in_service"] as const;

async function loadItems(reader: Reader, runId: string) {
  return reader
    .select({
      id: assetDepreciationRunItems.id,
      assetId: assetDepreciationRunItems.assetId,
      assetCode: fixedAssets.code,
      assetName: fixedAssets.name,
      periodKey: assetDepreciationRunItems.periodKey,
      openingBookValue: assetDepreciationRunItems.openingBookValue,
      depreciationAmount: assetDepreciationRunItems.depreciationAmount,
      accumulatedAfter: assetDepreciationRunItems.accumulatedAfter,
      closingBookValue: assetDepreciationRunItems.closingBookValue,
    })
    .from(assetDepreciationRunItems)
    .innerJoin(fixedAssets, eq(fixedAssets.id, assetDepreciationRunItems.assetId))
    .where(eq(assetDepreciationRunItems.runId, runId))
    .orderBy(asc(fixedAssets.code));
}

async function withDetails(reader: Reader, id: string) {
  const run = await requireRun(reader, id);
  return { ...run, items: await loadItems(reader, id) };
}

/* ------------------------------ Baca ------------------------------ */

export async function listRuns(actor: AuthContext, query: { periodId?: string; status?: string } = {}, externalTx?: Tx) {
  assertCan(actor, "assets.depreciation.read");
  const reader: Reader = externalTx ?? db;
  return reader
    .select(runColumns)
    .from(assetDepreciationRuns)
    .where(
      and(
        query.periodId ? eq(assetDepreciationRuns.periodId, query.periodId) : undefined,
        query.status ? eq(assetDepreciationRuns.status, query.status as never) : undefined,
      ),
    )
    .orderBy(desc(assetDepreciationRuns.createdAt));
}

export async function getRun(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "assets.depreciation.read");
  return withDetails(externalTx ?? db, id);
}

/* --------------------------- Buat run ----------------------------- */

export async function createRun(actor: AuthContext, input: CreateRunInput, externalTx?: Tx) {
  assertCan(actor, "assets.depreciation.manage");
  return inTx(externalTx, async (tx) => {
    const period = await requireAccountingPeriod(tx, input.periodId);
    if (period.status === "closed") throw businessRule("Periode akuntansi sudah ditutup.");

    const branchCond =
      input.branchId == null ? isNull(assetDepreciationRuns.branchId) : eq(assetDepreciationRuns.branchId, input.branchId);
    const [existing] = await tx
      .select({ id: assetDepreciationRuns.id })
      .from(assetDepreciationRuns)
      .where(
        and(
          eq(assetDepreciationRuns.periodId, input.periodId),
          inArray(assetDepreciationRuns.status, ["draft", "calculated", "approved", "posted"]),
          branchCond,
        ),
      )
      .limit(1);
    if (existing) throw businessRule("Sudah ada run penyusutan aktif untuk periode/cabang ini.");

    const [created] = await tx
      .insert(assetDepreciationRuns)
      .values({
        periodId: input.periodId,
        branchId: input.branchId ?? null,
        status: "draft",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: assetDepreciationRuns.id });
    if (!created) throw new Error("Gagal membuat run penyusutan.");
    await audit.log(
      { action: "assets.run.create", entityType: "asset_depreciation_run", entityId: created.id, actorId: actor.userId, after: { periodId: input.periodId, branchId: input.branchId ?? null } },
      tx,
    );
    return withDetails(tx, created.id);
  });
}

/* --------------------------- Kalkulasi ---------------------------- */

export async function calculateRun(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "assets.depreciation.manage");
  return inTx(externalTx, async (tx) => {
    const run = await lockRun(tx, id);
    if (run.status !== "draft" && run.status !== "calculated") {
      throw businessRule("Hanya run berstatus draft/calculated yang dapat dihitung ulang.");
    }
    const period = await requireAccountingPeriod(tx, run.periodId);
    if (period.status === "closed") throw businessRule("Periode sudah ditutup; tidak dapat menghitung.");
    const periodKey = periodKeyOf(period.startDate);

    const assets = await tx
      .select({
        id: fixedAssets.id,
        code: fixedAssets.code,
        cost: fixedAssets.cost,
        accumulatedDepreciation: fixedAssets.accumulatedDepreciation,
        residualValue: fixedAssets.residualValue,
        usefulLifeMonths: fixedAssets.usefulLifeMonths,
        assetMethod: fixedAssets.depreciationMethod,
        decliningRatePercent: fixedAssets.decliningRatePercent,
        totalUnits: fixedAssets.totalUnits,
        categoryId: assetCategories.id,
        catMethod: assetCategories.depreciationMethod,
        catUsefulLifeMonths: assetCategories.usefulLifeMonths,
        catResidualPercent: assetCategories.residualPercent,
        catDecliningRatePercent: assetCategories.decliningRatePercent,
        catTotalUnits: assetCategories.totalUnits,
      })
      .from(fixedAssets)
      .innerJoin(assetCategories, eq(assetCategories.id, fixedAssets.categoryId))
      .where(
        and(
          inArray(fixedAssets.status, DEPRECIABLE_STATUSES),
          eq(fixedAssets.isActive, true),
          run.branchId ? eq(fixedAssets.branchId, run.branchId) : undefined,
        ),
      );

    // Pemakaian periode utk units_of_production.
    const usageRows = await tx
      .select({ assetId: assetUsageEntries.assetId, units: assetUsageEntries.units })
      .from(assetUsageEntries)
      .where(eq(assetUsageEntries.periodKey, periodKey));
    const usageByAsset = new Map(usageRows.map((u) => [u.assetId, u.units]));

    await tx.delete(assetDepreciationRunItems).where(eq(assetDepreciationRunItems.runId, id));

    let total = "0.00";
    let count = 0;
    for (const a of assets) {
      const method: DepreciationMethod = a.assetMethod ?? a.catMethod;
      const periodUnits = method === "units_of_production" ? usageByAsset.get(a.id) ?? null : null;
      const params = resolveDepreciationParams({
        asset: {
          cost: a.cost,
          accumulatedDepreciation: a.accumulatedDepreciation,
          residualValue: a.residualValue,
          usefulLifeMonths: a.usefulLifeMonths,
          depreciationMethod: a.assetMethod,
          decliningRatePercent: a.decliningRatePercent,
          totalUnits: a.totalUnits,
        },
        category: {
          depreciationMethod: a.catMethod,
          usefulLifeMonths: a.catUsefulLifeMonths,
          residualPercent: a.catResidualPercent,
          decliningRatePercent: a.catDecliningRatePercent,
          totalUnits: a.catTotalUnits,
        },
        periodUnits,
      });
      const amount = computePeriodDepreciation(params);
      if (cmp(amount, "0") <= 0) continue;

      const openingBookValue = toDb(sub(a.cost, a.accumulatedDepreciation));
      const accumulatedAfter = toDb(add(a.accumulatedDepreciation, amount));
      const closingBookValue = toDb(sub(a.cost, accumulatedAfter));

      await tx.insert(assetDepreciationRunItems).values({
        runId: id,
        assetId: a.id,
        periodKey,
        openingBookValue,
        depreciationAmount: amount,
        accumulatedAfter,
        closingBookValue,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      });

      await tx
        .insert(assetDepreciationSchedules)
        .values({
          assetId: a.id,
          periodKey,
          seqNo: period.periodNo,
          openingBookValue,
          depreciationAmount: amount,
          accumulatedAfter,
          closingBookValue,
          isBooked: false,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        })
        .onConflictDoUpdate({
          target: [assetDepreciationSchedules.assetId, assetDepreciationSchedules.periodKey],
          set: {
            seqNo: period.periodNo,
            openingBookValue,
            depreciationAmount: amount,
            accumulatedAfter,
            closingBookValue,
            updatedBy: actor.userId,
            updatedAt: new Date(),
          },
        });

      total = toDb(add(total, amount));
      count += 1;
    }

    await tx
      .update(assetDepreciationRuns)
      .set({ status: "calculated", assetCount: count, totalDepreciation: total, calculatedBy: actor.userId, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(assetDepreciationRuns.id, id));
    await audit.log(
      { action: "assets.run.calculate", entityType: "asset_depreciation_run", entityId: id, actorId: actor.userId, after: { assetCount: count, totalDepreciation: total } },
      tx,
    );
    return withDetails(tx, id);
  });
}

/* ---------------------------- Approve (SoD) ----------------------- */

export async function approveRun(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "assets.depreciation.post");
  return inTx(externalTx, async (tx) => {
    const run = await lockRun(tx, id);
    if (run.status !== "calculated") throw businessRule("Hanya run berstatus calculated yang dapat disetujui.");
    if (run.createdBy === actor.userId) throw businessRule("Pembuat run tidak dapat menyetujuinya sendiri.");
    if (run.calculatedBy === actor.userId) throw businessRule("Yang menghitung run tidak dapat menyetujuinya.");
    if (run.assetCount <= 0) throw businessRule("Run tanpa aset tidak dapat disetujui.");

    await tx
      .update(assetDepreciationRuns)
      .set({ status: "approved", approvedBy: actor.userId, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(assetDepreciationRuns.id, id));
    await audit.log(
      { action: "assets.run.approve", entityType: "asset_depreciation_run", entityId: id, actorId: actor.userId, after: { status: "approved" } },
      tx,
    );
    return withDetails(tx, id);
  });
}

/* ------------------------------ Post ------------------------------ */

export async function postRun(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "assets.depreciation.post");
  return inTx(externalTx, async (tx) => {
    const run = await lockRun(tx, id);
    if (run.status !== "approved") throw businessRule("Hanya run berstatus approved yang dapat diposting.");
    const period = await requireAccountingPeriod(tx, run.periodId);
    const periodKey = periodKeyOf(period.startDate);
    if (cmp(run.totalDepreciation, "0") <= 0) throw businessRule("Total penyusutan run nol; tidak dapat diposting.");

    const accounts = await resolveAssetAccountIds(tx);
    const lines = buildDepreciationJournalLines(
      {
        depreciationExpenseAccountId: accounts.depreciationExpenseAccountId,
        accumulatedDepreciationAccountId: accounts.accumulatedDepreciationAccountId,
      },
      run.totalDepreciation,
    );

    const draft = await createSystemDraft(tx, actor, {
      entryDate: period.endDate,
      description: `Jurnal penyusutan ${period.periodNo}/${period.startDate.slice(0, 4)}`,
      lines,
      sourceType: SOURCE_DEPRECIATION,
      sourceId: run.id,
      sourceEvent: "post",
      idempotencyKey: `asset_depreciation_post:${run.id}`,
    });
    const posted = await postJournal(actor, draft.id, tx);

    const docNo = await nextDocumentNumber(tx, "depreciation_run", {
      date: period.endDate,
      branchId: run.branchId ?? undefined,
    });

    // Terapkan ke register + tandai jadwal booked.
    const items = await loadItems(tx, id);
    for (const it of items) {
      const [a] = await tx
        .select({ accumulatedDepreciation: fixedAssets.accumulatedDepreciation })
        .from(fixedAssets)
        .where(eq(fixedAssets.id, it.assetId))
        .limit(1);
      if (!a) continue;
      await tx
        .update(fixedAssets)
        .set({
          accumulatedDepreciation: toDb(add(a.accumulatedDepreciation, it.depreciationAmount)),
          updatedBy: actor.userId,
          updatedAt: new Date(),
        })
        .where(eq(fixedAssets.id, it.assetId));
      await tx
        .update(assetDepreciationSchedules)
        .set({ isBooked: true, runItemId: it.id, updatedBy: actor.userId, updatedAt: new Date() })
        .where(and(eq(assetDepreciationSchedules.assetId, it.assetId), eq(assetDepreciationSchedules.periodKey, periodKey)));
    }

    await tx
      .update(assetDepreciationRuns)
      .set({ status: "posted", docNo, journalEntryId: posted.id, postedAt: new Date(), updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(assetDepreciationRuns.id, id));
    await audit.log(
      { action: "assets.run.post", entityType: "asset_depreciation_run", entityId: id, actorId: actor.userId, after: { status: "posted", docNo, journalEntryId: posted.id } },
      tx,
    );
    return withDetails(tx, id);
  });
}

/* ----------------------------- Cancel ----------------------------- */

export async function cancelRun(actor: AuthContext, id: string, reason: string, externalTx?: Tx) {
  assertCan(actor, "assets.depreciation.manage");
  return inTx(externalTx, async (tx) => {
    const run = await lockRun(tx, id);
    if (run.status !== "draft" && run.status !== "calculated") {
      throw businessRule("Hanya run draft/calculated yang dapat dibatalkan. Gunakan reversal untuk run posted.");
    }
    await tx
      .update(assetDepreciationRuns)
      .set({ status: "cancelled", reason, cancelledAt: new Date(), updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(assetDepreciationRuns.id, id));
    await audit.log(
      { action: "assets.run.cancel", entityType: "asset_depreciation_run", entityId: id, actorId: actor.userId, after: { status: "cancelled", reason } },
      tx,
    );
    return withDetails(tx, id);
  });
}

/* ----------------------------- Reverse ---------------------------- */

export async function reverseRun(actor: AuthContext, id: string, reason: string, externalTx?: Tx) {
  assertCan(actor, "assets.depreciation.post");
  return inTx(externalTx, async (tx) => {
    const run = await lockRun(tx, id);
    if (run.status !== "posted") throw businessRule("Hanya run berstatus posted yang dapat dibalik.");
    if (!run.journalEntryId) throw businessRule("Run posted tanpa jurnal terkait; tidak dapat dibalik.");
    const period = await requireAccountingPeriod(tx, run.periodId);
    const periodKey = periodKeyOf(period.startDate);

    await reverseJournal(actor, run.journalEntryId, { reason }, tx);

    const items = await loadItems(tx, id);
    for (const it of items) {
      const [a] = await tx
        .select({ accumulatedDepreciation: fixedAssets.accumulatedDepreciation })
        .from(fixedAssets)
        .where(eq(fixedAssets.id, it.assetId))
        .limit(1);
      if (!a) continue;
      await tx
        .update(fixedAssets)
        .set({
          accumulatedDepreciation: toDb(sub(a.accumulatedDepreciation, it.depreciationAmount)),
          updatedBy: actor.userId,
          updatedAt: new Date(),
        })
        .where(eq(fixedAssets.id, it.assetId));
      await tx
        .update(assetDepreciationSchedules)
        .set({ isBooked: false, runItemId: null, updatedBy: actor.userId, updatedAt: new Date() })
        .where(and(eq(assetDepreciationSchedules.assetId, it.assetId), eq(assetDepreciationSchedules.periodKey, periodKey)));
    }

    await tx
      .update(assetDepreciationRuns)
      .set({ status: "reversed", reason, reversedAt: new Date(), updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(assetDepreciationRuns.id, id));
    await audit.log(
      { action: "assets.run.reverse", entityType: "asset_depreciation_run", entityId: id, actorId: actor.userId, after: { status: "reversed", reason } },
      tx,
    );
    return withDetails(tx, id);
  });
}

/** Jadwal penyusutan sebuah aset (untuk laporan ledger). */
export async function listSchedules(actor: AuthContext, assetId: string, externalTx?: Tx) {
  assertCan(actor, "assets.depreciation.read");
  const reader: Reader = externalTx ?? db;
  return reader
    .select()
    .from(assetDepreciationSchedules)
    .where(eq(assetDepreciationSchedules.assetId, assetId))
    .orderBy(asc(assetDepreciationSchedules.periodKey));
}
