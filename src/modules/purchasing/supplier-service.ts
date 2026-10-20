import { and, asc, eq, ilike, or, type SQL } from "drizzle-orm";

import { paymentTerms, suppliers } from "@/db/schema";
import { assertActiveCurrency } from "@/modules/purchasing/_refs";
import type {
  CreateSupplierInput,
  ListSuppliersQuery,
  UpdateSupplierInput,
} from "@/modules/purchasing/schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { conflict, forbidden, notFound, validationFailed } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Tx | typeof db;

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

const supplierColumns = {
  id: suppliers.id,
  code: suppliers.code,
  name: suppliers.name,
  taxId: suppliers.taxId,
  currency: suppliers.currency,
  paymentTermsId: suppliers.paymentTermsId,
  paymentTermsName: paymentTerms.name,
  email: suppliers.email,
  phone: suppliers.phone,
  address: suppliers.address,
  notes: suppliers.notes,
  isActive: suppliers.isActive,
  createdAt: suppliers.createdAt,
  updatedAt: suppliers.updatedAt,
};

function supplierQuery(reader: Reader) {
  return reader
    .select(supplierColumns)
    .from(suppliers)
    .leftJoin(paymentTerms, eq(paymentTerms.id, suppliers.paymentTermsId));
}

async function requireSupplier(reader: Reader, id: string) {
  const [row] = await supplierQuery(reader).where(eq(suppliers.id, id)).limit(1);
  if (!row) throw notFound("Pemasok tidak ditemukan.");
  return row;
}

async function lockSupplier(tx: Tx, id: string) {
  const [row] = await tx
    .select({ id: suppliers.id, isActive: suppliers.isActive, code: suppliers.code })
    .from(suppliers)
    .where(eq(suppliers.id, id))
    .for("update")
    .limit(1);
  if (!row) throw notFound("Pemasok tidak ditemukan.");
  return row;
}

/** Termin pembayaran opsional: bila diisi harus ada & aktif. */
async function assertPaymentTermUsable(
  tx: Tx,
  id: string | null | undefined,
): Promise<void> {
  if (id === null || id === undefined) return;
  const [row] = await tx
    .select({ id: paymentTerms.id, isActive: paymentTerms.isActive })
    .from(paymentTerms)
    .where(eq(paymentTerms.id, id))
    .for("share")
    .limit(1);
  if (!row) throw validationFailed([{ path: "paymentTermsId", message: "Termin pembayaran tidak ditemukan." }]);
  if (!row.isActive) throw conflict("Termin pembayaran tidak aktif.");
}

/* ------------------------------- Baca ------------------------------ */

export async function listSuppliers(actor: AuthContext, query: ListSuppliersQuery = {}, externalTx?: Tx) {
  assertCan(actor, "purchasing.suppliers.read");
  const reader = externalTx ?? db;

  const conditions: (SQL | undefined)[] = [
    query.isActive === undefined ? undefined : eq(suppliers.isActive, query.isActive),
    query.search === undefined
      ? undefined
      : or(ilike(suppliers.name, `%${query.search}%`), ilike(suppliers.code, `%${query.search}%`)),
  ];

  return supplierQuery(reader)
    .where(and(...conditions))
    .orderBy(asc(suppliers.code));
}

export async function getSupplier(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "purchasing.suppliers.read");
  return requireSupplier(externalTx ?? db, id);
}

/* ------------------------------- Tulis ----------------------------- */

export async function createSupplier(actor: AuthContext, input: CreateSupplierInput, externalTx?: Tx) {
  assertCan(actor, "purchasing.suppliers.manage");

  const run = async (tx: Tx) => {
    const [dup] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.code, input.code))
      .limit(1);
    if (dup) throw conflict("Kode pemasok sudah dipakai.");

    const currency = input.currency ?? "IDR";
    await assertActiveCurrency(tx, currency);
    await assertPaymentTermUsable(tx, input.paymentTermsId);

    const values = {
      code: input.code,
      name: input.name,
      taxId: input.taxId ?? null,
      currency,
      paymentTermsId: input.paymentTermsId ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      address: input.address ?? null,
      notes: input.notes ?? null,
    };

    const [created] = await tx
      .insert(suppliers)
      .values({ ...values, isActive: true, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: suppliers.id });
    if (!created) throw new Error("Gagal membuat pemasok.");

    await audit.log(
      {
        action: "supplier.create",
        entityType: "supplier",
        entityId: created.id,
        actorId: actor.userId,
        after: values,
      },
      tx,
    );

    return requireSupplier(tx, created.id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

const UPDATABLE_FIELDS = [
  "name",
  "taxId",
  "currency",
  "paymentTermsId",
  "email",
  "phone",
  "address",
  "notes",
  "isActive",
] as const;

export async function updateSupplier(
  actor: AuthContext,
  id: string,
  input: UpdateSupplierInput,
  externalTx?: Tx,
) {
  assertCan(actor, "purchasing.suppliers.manage");

  const run = async (tx: Tx) => {
    await lockSupplier(tx, id);
    const current = await requireSupplier(tx, id);

    const next = {
      name: input.name ?? current.name,
      taxId: input.taxId === undefined ? current.taxId : input.taxId,
      currency: input.currency ?? current.currency,
      paymentTermsId:
        input.paymentTermsId === undefined ? current.paymentTermsId : input.paymentTermsId,
      email: input.email === undefined ? current.email : input.email,
      phone: input.phone === undefined ? current.phone : input.phone,
      address: input.address === undefined ? current.address : input.address,
      notes: input.notes === undefined ? current.notes : input.notes,
      isActive: input.isActive ?? current.isActive,
    };

    const changedFields = UPDATABLE_FIELDS.filter((field) => next[field] !== current[field]);
    if (changedFields.length === 0) return current;

    if (next.currency !== current.currency) {
      await assertActiveCurrency(tx, next.currency);
    }
    if (next.paymentTermsId !== current.paymentTermsId) {
      await assertPaymentTermUsable(tx, next.paymentTermsId);
    }

    await tx
      .update(suppliers)
      .set({ ...next, updatedAt: new Date(), updatedBy: actor.userId })
      .where(eq(suppliers.id, id));

    await audit.log(
      {
        action: "supplier.update",
        entityType: "supplier",
        entityId: id,
        actorId: actor.userId,
        before: Object.fromEntries(changedFields.map((f) => [f, current[f]])),
        after: Object.fromEntries(changedFields.map((f) => [f, next[f]])),
      },
      tx,
    );

    return requireSupplier(tx, id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

/**
 * Pemasok aktif untuk header dokumen (PO/invoice). Dikunci FOR SHARE agar
 * penonaktifan menunggu transaksi ini. Mengembalikan id + currency + termin.
 */
export async function requireActiveSupplier(tx: Tx, id: string, path = "supplierId") {
  const [row] = await tx
    .select({
      id: suppliers.id,
      isActive: suppliers.isActive,
      currency: suppliers.currency,
      paymentTermsId: suppliers.paymentTermsId,
    })
    .from(suppliers)
    .where(eq(suppliers.id, id))
    .for("share")
    .limit(1);
  if (!row) throw validationFailed([{ path, message: "Pemasok tidak ditemukan." }]);
  if (!row.isActive) throw conflict("Pemasok tidak aktif.");
  return row;
}
