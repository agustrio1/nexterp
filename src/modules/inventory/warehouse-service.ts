import { and, asc, eq, sql } from "drizzle-orm";

import { branches, warehouseLocations, warehouses } from "@/db/schema";
import type {
  CreateWarehouseInput,
  CreateWarehouseLocationInput,
  ListWarehouseLocationsQuery,
  ListWarehousesQuery,
  UpdateWarehouseInput,
  UpdateWarehouseLocationInput,
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

/* --------------------------- Gudang (header) --------------------------- */

const warehouseColumns = {
  id: warehouses.id,
  code: warehouses.code,
  name: warehouses.name,
  branchId: warehouses.branchId,
  branchCode: branches.code,
  branchName: branches.name,
  isActive: warehouses.isActive,
  address: warehouses.address,
  description: warehouses.description,
  createdAt: warehouses.createdAt,
  updatedAt: warehouses.updatedAt,
};

function warehouseQuery(reader: Reader) {
  return reader
    .select(warehouseColumns)
    .from(warehouses)
    .innerJoin(branches, eq(branches.id, warehouses.branchId));
}

async function requireWarehouse(reader: Reader, id: string) {
  const [row] = await warehouseQuery(reader).where(eq(warehouses.id, id)).limit(1);
  if (!row) throw notFound("Gudang tidak ditemukan.");
  return row;
}

async function lockWarehouse(tx: Tx, id: string) {
  const [row] = await tx
    .select({
      id: warehouses.id,
      code: warehouses.code,
      name: warehouses.name,
      branchId: warehouses.branchId,
      isActive: warehouses.isActive,
      address: warehouses.address,
      description: warehouses.description,
    })
    .from(warehouses)
    .where(eq(warehouses.id, id))
    .for("update")
    .limit(1);
  if (!row) throw notFound("Gudang tidak ditemukan.");
  return row;
}

/** Cabang harus ada & aktif (dikunci FOR SHARE agar penonaktifan cabang menunggu). */
async function assertActiveBranch(tx: Tx, branchId: string): Promise<void> {
  const [branch] = await tx
    .select({ id: branches.id, isActive: branches.isActive })
    .from(branches)
    .where(eq(branches.id, branchId))
    .for("share")
    .limit(1);
  if (!branch) {
    throw validationFailed([{ path: "branchId", message: "Cabang tidak ditemukan." }]);
  }
  if (!branch.isActive) throw businessRule("Cabang tidak aktif.");
}

async function countActiveLocations(tx: Tx, warehouseId: string): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(warehouseLocations)
    .where(
      and(
        eq(warehouseLocations.warehouseId, warehouseId),
        eq(warehouseLocations.isActive, true),
      ),
    );
  return row?.count ?? 0;
}

export async function listWarehouses(
  actor: AuthContext,
  query: ListWarehousesQuery = {},
  externalTx?: Tx,
) {
  assertCan(actor, "inventory.warehouses.read");
  const reader = externalTx ?? db;
  const conditions = [
    query.isActive === undefined ? undefined : eq(warehouses.isActive, query.isActive),
    query.branchId === undefined ? undefined : eq(warehouses.branchId, query.branchId),
  ];
  return warehouseQuery(reader)
    .where(and(...conditions))
    .orderBy(asc(warehouses.code));
}

export async function getWarehouse(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "inventory.warehouses.read");
  return requireWarehouse(externalTx ?? db, id);
}

export async function createWarehouse(
  actor: AuthContext,
  input: CreateWarehouseInput,
  externalTx?: Tx,
) {
  assertCan(actor, "inventory.warehouses.manage");

  const run = async (tx: Tx) => {
    const [dup] = await tx
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(eq(warehouses.code, input.code))
      .limit(1);
    if (dup) throw conflict("Kode gudang sudah dipakai.");

    await assertActiveBranch(tx, input.branchId);

    const values = {
      code: input.code,
      name: input.name,
      branchId: input.branchId,
      address: input.address ?? null,
      description: input.description ?? null,
    };

    const [created] = await tx
      .insert(warehouses)
      .values({ ...values, isActive: true, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: warehouses.id });
    if (!created) throw new Error("Gagal membuat gudang.");

    await audit.log(
      {
        action: "warehouse.create",
        entityType: "warehouse",
        entityId: created.id,
        actorId: actor.userId,
        after: values,
      },
      tx,
    );
    return requireWarehouse(tx, created.id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

const WAREHOUSE_UPDATABLE = ["name", "branchId", "address", "description", "isActive"] as const;

export async function updateWarehouse(
  actor: AuthContext,
  id: string,
  input: UpdateWarehouseInput,
  externalTx?: Tx,
) {
  assertCan(actor, "inventory.warehouses.manage");

  const run = async (tx: Tx) => {
    const warehouse = await lockWarehouse(tx, id);

    const next = {
      name: input.name ?? warehouse.name,
      branchId: input.branchId ?? warehouse.branchId,
      address: input.address === undefined ? warehouse.address : input.address,
      description: input.description === undefined ? warehouse.description : input.description,
      isActive: input.isActive ?? warehouse.isActive,
    };

    const changedFields = WAREHOUSE_UPDATABLE.filter((field) => next[field] !== warehouse[field]);
    if (changedFields.length === 0) return requireWarehouse(tx, id);

    if (changedFields.includes("branchId")) {
      await assertActiveBranch(tx, next.branchId);
    }

    if (warehouse.isActive && !next.isActive) {
      const activeLocations = await countActiveLocations(tx, id);
      if (activeLocations > 0) {
        throw conflict(`Gudang masih memiliki ${activeLocations} lokasi aktif.`);
      }
    }

    await tx
      .update(warehouses)
      .set({ ...next, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(warehouses.id, id));

    await audit.log(
      {
        action: "warehouse.update",
        entityType: "warehouse",
        entityId: id,
        actorId: actor.userId,
        before: Object.fromEntries(changedFields.map((field) => [field, warehouse[field]])),
        after: Object.fromEntries(changedFields.map((field) => [field, next[field]])),
      },
      tx,
    );
    return requireWarehouse(tx, id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

/* ------------------------------ Lokasi ------------------------------ */

const locationColumns = {
  id: warehouseLocations.id,
  warehouseId: warehouseLocations.warehouseId,
  code: warehouseLocations.code,
  name: warehouseLocations.name,
  isActive: warehouseLocations.isActive,
  description: warehouseLocations.description,
  createdAt: warehouseLocations.createdAt,
  updatedAt: warehouseLocations.updatedAt,
};

function locationQuery(reader: Reader) {
  return reader
    .select({ ...locationColumns, warehouseCode: warehouses.code, warehouseName: warehouses.name })
    .from(warehouseLocations)
    .innerJoin(warehouses, eq(warehouses.id, warehouseLocations.warehouseId));
}

async function requireLocation(reader: Reader, id: string) {
  const [row] = await locationQuery(reader).where(eq(warehouseLocations.id, id)).limit(1);
  if (!row) throw notFound("Lokasi gudang tidak ditemukan.");
  return row;
}

/** Gudang harus ada & aktif (dipakai validasi pembuatan lokasi). */
async function assertActiveWarehouse(tx: Tx, warehouseId: string): Promise<void> {
  const [row] = await tx
    .select({ id: warehouses.id, isActive: warehouses.isActive })
    .from(warehouses)
    .where(eq(warehouses.id, warehouseId))
    .for("share")
    .limit(1);
  if (!row) {
    throw validationFailed([{ path: "warehouseId", message: "Gudang tidak ditemukan." }]);
  }
  if (!row.isActive) throw businessRule("Gudang tidak aktif.");
}

export async function listWarehouseLocations(
  actor: AuthContext,
  query: ListWarehouseLocationsQuery = {},
  externalTx?: Tx,
) {
  assertCan(actor, "inventory.warehouses.read");
  const reader = externalTx ?? db;
  const conditions = [
    query.warehouseId === undefined
      ? undefined
      : eq(warehouseLocations.warehouseId, query.warehouseId),
    query.isActive === undefined ? undefined : eq(warehouseLocations.isActive, query.isActive),
  ];
  return locationQuery(reader)
    .where(and(...conditions))
    .orderBy(asc(warehouseLocations.warehouseId), asc(warehouseLocations.code));
}

export async function getWarehouseLocation(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "inventory.warehouses.read");
  return requireLocation(externalTx ?? db, id);
}

export async function createWarehouseLocation(
  actor: AuthContext,
  input: CreateWarehouseLocationInput,
  externalTx?: Tx,
) {
  assertCan(actor, "inventory.warehouses.manage");

  const run = async (tx: Tx) => {
    await assertActiveWarehouse(tx, input.warehouseId);

    const [dup] = await tx
      .select({ id: warehouseLocations.id })
      .from(warehouseLocations)
      .where(
        and(
          eq(warehouseLocations.warehouseId, input.warehouseId),
          eq(warehouseLocations.code, input.code),
        ),
      )
      .limit(1);
    if (dup) throw conflict("Kode lokasi sudah dipakai di gudang ini.");

    const values = {
      warehouseId: input.warehouseId,
      code: input.code,
      name: input.name,
      description: input.description ?? null,
    };

    const [created] = await tx
      .insert(warehouseLocations)
      .values({ ...values, isActive: true, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: warehouseLocations.id });
    if (!created) throw new Error("Gagal membuat lokasi gudang.");

    await audit.log(
      {
        action: "warehouse_location.create",
        entityType: "warehouse_location",
        entityId: created.id,
        actorId: actor.userId,
        after: values,
      },
      tx,
    );
    return requireLocation(tx, created.id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

const LOCATION_UPDATABLE = ["name", "description", "isActive"] as const;

export async function updateWarehouseLocation(
  actor: AuthContext,
  id: string,
  input: UpdateWarehouseLocationInput,
  externalTx?: Tx,
) {
  assertCan(actor, "inventory.warehouses.manage");

  const run = async (tx: Tx) => {
    // Gudang & kode lokasi imutabel (identitas master); hanya nama/deskripsi/status.
    const [current] = await tx
      .select(locationColumns)
      .from(warehouseLocations)
      .where(eq(warehouseLocations.id, id))
      .for("update")
      .limit(1);
    if (!current) throw notFound("Lokasi gudang tidak ditemukan.");

    const next = {
      name: input.name ?? current.name,
      description: input.description === undefined ? current.description : input.description,
      isActive: input.isActive ?? current.isActive,
    };

    const changedFields = LOCATION_UPDATABLE.filter((field) => next[field] !== current[field]);
    if (changedFields.length === 0) return requireLocation(tx, id);

    await tx
      .update(warehouseLocations)
      .set({ ...next, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(warehouseLocations.id, id));

    await audit.log(
      {
        action: "warehouse_location.update",
        entityType: "warehouse_location",
        entityId: id,
        actorId: actor.userId,
        before: Object.fromEntries(changedFields.map((field) => [field, current[field]])),
        after: Object.fromEntries(changedFields.map((field) => [field, next[field]])),
      },
      tx,
    );
    return requireLocation(tx, id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}
