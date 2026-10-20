import { desc, eq } from "drizzle-orm";

import { assetMaintenance, assetTransfers, fixedAssets } from "@/db/schema";
import type { CreateMaintenanceInput, CreateTransferInput } from "@/modules/assets/schemas";
import { assertCan, inTx, requireLiveAsset, type Reader, type Tx } from "@/modules/assets/_refs";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import type { AuthContext } from "@/server/authz";

/* ----------------------------- Transfer ---------------------------- */

export async function listTransfers(actor: AuthContext, assetId?: string, externalTx?: Tx) {
  assertCan(actor, "assets.register.read");
  const reader: Reader = externalTx ?? db;
  return reader
    .select()
    .from(assetTransfers)
    .where(assetId ? eq(assetTransfers.assetId, assetId) : undefined)
    .orderBy(desc(assetTransfers.transferDate));
}

/**
 * Pindah penempatan aset. Mencatat riwayat transfer dan menerapkan tujuan
 * (cabang/departemen/pusat biaya) ke register — tanpa jurnal (operasional).
 */
export async function createTransfer(actor: AuthContext, input: CreateTransferInput, externalTx?: Tx) {
  assertCan(actor, "assets.register.manage");
  return inTx(externalTx, async (tx) => {
    const asset = await requireLiveAsset(tx, input.assetId);
    const [created] = await tx
      .insert(assetTransfers)
      .values({
        assetId: input.assetId,
        transferDate: input.transferDate,
        fromBranchId: input.fromBranchId ?? asset.branchId,
        toBranchId: input.toBranchId ?? null,
        fromDepartmentId: input.fromDepartmentId ?? asset.departmentId,
        toDepartmentId: input.toDepartmentId ?? null,
        toCostCenterId: input.toCostCenterId ?? null,
        notes: input.notes ?? null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning();
    if (input.toBranchId || input.toDepartmentId || input.toCostCenterId) {
      await tx
        .update(fixedAssets)
        .set({
          branchId: input.toBranchId ?? asset.branchId,
          departmentId: input.toDepartmentId ?? asset.departmentId,
          costCenterId: input.toCostCenterId ?? asset.costCenterId,
          updatedBy: actor.userId,
          updatedAt: new Date(),
        })
        .where(eq(fixedAssets.id, input.assetId));
    }
    await audit.log(
      { action: "assets.transfer.create", entityType: "asset_transfer", entityId: created?.id ?? null, actorId: actor.userId, after: { assetId: input.assetId, toBranchId: input.toBranchId ?? null, toDepartmentId: input.toDepartmentId ?? null } },
      tx,
    );
    return created;
  });
}

/* ---------------------------- Perawatan ---------------------------- */

export async function listMaintenance(actor: AuthContext, assetId?: string, externalTx?: Tx) {
  assertCan(actor, "assets.register.read");
  const reader: Reader = externalTx ?? db;
  return reader
    .select()
    .from(assetMaintenance)
    .where(assetId ? eq(assetMaintenance.assetId, assetId) : undefined)
    .orderBy(desc(assetMaintenance.maintenanceDate));
}

/** Catatan perawatan/perbaikan (subledger biaya operasional; tanpa jurnal otomatis). */
export async function createMaintenance(actor: AuthContext, input: CreateMaintenanceInput, externalTx?: Tx) {
  assertCan(actor, "assets.register.manage");
  return inTx(externalTx, async (tx) => {
    await requireLiveAsset(tx, input.assetId);
    const [created] = await tx
      .insert(assetMaintenance)
      .values({
        assetId: input.assetId,
        maintenanceDate: input.maintenanceDate,
        description: input.description,
        vendor: input.vendor ?? null,
        cost: input.cost ?? null,
        notes: input.notes ?? null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning();
    await audit.log(
      { action: "assets.maintenance.create", entityType: "asset_maintenance", entityId: created?.id ?? null, actorId: actor.userId, after: { assetId: input.assetId, cost: input.cost ?? null } },
      tx,
    );
    return created;
  });
}
