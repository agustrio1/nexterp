import { and, asc, desc, eq, lte } from "drizzle-orm";

import { chartAccounts, taxRates, taxes } from "@/db/schema";
import type {
  CreateTaxInput,
  CreateTaxRateInput,
  ListTaxesQuery,
  UpdateTaxInput,
} from "@/modules/accounting/tax-cost-schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { businessRule, conflict, forbidden, notFound, validationFailed } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "select">;

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

async function inTx<T>(externalTx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (externalTx) return fn(externalTx);
  return db.transaction(fn);
}

const taxColumns = {
  id: taxes.id,
  code: taxes.code,
  name: taxes.name,
  kind: taxes.kind,
  taxAccountId: taxes.taxAccountId,
  accountCode: chartAccounts.code,
  accountName: chartAccounts.name,
  isActive: taxes.isActive,
  description: taxes.description,
  createdAt: taxes.createdAt,
  updatedAt: taxes.updatedAt,
};

const rateColumns = {
  id: taxRates.id,
  taxId: taxRates.taxId,
  rate: taxRates.rate,
  effectiveFrom: taxRates.effectiveFrom,
  source: taxRates.source,
  note: taxRates.note,
  createdAt: taxRates.createdAt,
};

/** Akun pajak harus ada, aktif, dan postable. */
async function assertAccountUsable(tx: Tx, accountId: string): Promise<void> {
  const [account] = await tx
    .select({
      id: chartAccounts.id,
      code: chartAccounts.code,
      isActive: chartAccounts.isActive,
      isPostable: chartAccounts.isPostable,
    })
    .from(chartAccounts)
    .where(eq(chartAccounts.id, accountId))
    .limit(1);
  if (!account) {
    throw validationFailed([{ path: "taxAccountId", message: "Akun pajak tidak ditemukan." }]);
  }
  if (!account.isActive) {
    throw businessRule(`Akun pajak ${account.code} tidak aktif.`);
  }
  if (!account.isPostable) {
    throw businessRule(`Akun pajak ${account.code} bukan akun postable (induk pohon).`);
  }
}

async function requireTax(reader: Reader, id: string) {
  const [row] = await reader
    .select(taxColumns)
    .from(taxes)
    .innerJoin(chartAccounts, eq(chartAccounts.id, taxes.taxAccountId))
    .where(eq(taxes.id, id))
    .limit(1);
  if (!row) throw notFound("Pajak tidak ditemukan.");
  return row;
}

/* ------------------------------------------------------------------ */
/* Baca                                                                */
/* ------------------------------------------------------------------ */

export async function listTaxes(actor: AuthContext, query: ListTaxesQuery = {}, externalTx?: Tx) {
  assertCan(actor, "accounting.taxes.read");

  const reader: Reader = externalTx ?? db;
  const conditions = [
    query.isActive === undefined ? undefined : eq(taxes.isActive, query.isActive),
    query.kind === undefined ? undefined : eq(taxes.kind, query.kind),
  ];

  return reader
    .select(taxColumns)
    .from(taxes)
    .innerJoin(chartAccounts, eq(chartAccounts.id, taxes.taxAccountId))
    .where(and(...conditions))
    .orderBy(asc(taxes.code));
}

export async function getTax(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "accounting.taxes.read");
  return requireTax(externalTx ?? db, id);
}

export async function listTaxRates(actor: AuthContext, taxId: string, externalTx?: Tx) {
  assertCan(actor, "accounting.taxes.read");

  const reader: Reader = externalTx ?? db;
  await requireTax(reader, taxId);
  return reader
    .select(rateColumns)
    .from(taxRates)
    .where(eq(taxRates.taxId, taxId))
    .orderBy(desc(taxRates.effectiveFrom));
}

/**
 * Tarif berlaku pada tanggal: `effectiveFrom` terbaru yang <= tanggal transaksi.
 * Mengembalikan null bila belum ada tarif yang berlaku (mis. tanggal sebelum
 * tarif pertama). Dipakai pembuatan transaksi pajak.
 */
export async function resolveEffectiveRate(
  reader: Reader,
  taxId: string,
  date: string,
): Promise<{ id: string; rate: string } | null> {
  const [row] = await reader
    .select({ id: taxRates.id, rate: taxRates.rate })
    .from(taxRates)
    .where(and(eq(taxRates.taxId, taxId), lte(taxRates.effectiveFrom, date)))
    .orderBy(desc(taxRates.effectiveFrom))
    .limit(1);
  return row ?? null;
}

/* ------------------------------------------------------------------ */
/* Tulis                                                               */
/* ------------------------------------------------------------------ */

export async function createTax(actor: AuthContext, input: CreateTaxInput, externalTx?: Tx) {
  assertCan(actor, "accounting.taxes.manage");

  return inTx(externalTx, async (tx) => {
    const [existing] = await tx
      .select({ id: taxes.id })
      .from(taxes)
      .where(eq(taxes.code, input.code))
      .limit(1);
    if (existing) throw conflict("Kode pajak sudah dipakai.");

    await assertAccountUsable(tx, input.taxAccountId);

    const values = {
      code: input.code,
      name: input.name,
      kind: input.kind,
      taxAccountId: input.taxAccountId,
      description: input.description ?? null,
    };

    const [created] = await tx
      .insert(taxes)
      .values({ ...values, isActive: true, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: taxes.id });
    if (!created) throw new Error("Gagal membuat pajak.");

    await audit.log(
      {
        action: "tax.create",
        entityType: "tax",
        entityId: created.id,
        actorId: actor.userId,
        after: values,
      },
      tx,
    );

    return requireTax(tx, created.id);
  });
}

const UPDATABLE_TAX_FIELDS = ["name", "kind", "taxAccountId", "isActive", "description"] as const;

export async function updateTax(
  actor: AuthContext,
  id: string,
  input: UpdateTaxInput,
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.taxes.manage");

  return inTx(externalTx, async (tx) => {
    const [current] = await tx
      .select(taxColumns)
      .from(taxes)
      .innerJoin(chartAccounts, eq(chartAccounts.id, taxes.taxAccountId))
      .where(eq(taxes.id, id))
      .for("update")
      .limit(1);
    if (!current) throw notFound("Pajak tidak ditemukan.");

    const next = {
      name: input.name ?? current.name,
      kind: input.kind ?? current.kind,
      taxAccountId: input.taxAccountId ?? current.taxAccountId,
      isActive: input.isActive ?? current.isActive,
      description: input.description === undefined ? current.description : input.description,
    };

    const changed = UPDATABLE_TAX_FIELDS.filter((field) => next[field] !== current[field]);
    if (changed.length === 0) return current;

    if (input.taxAccountId !== undefined && input.taxAccountId !== current.taxAccountId) {
      await assertAccountUsable(tx, next.taxAccountId);
    }

    await tx
      .update(taxes)
      .set({ ...next, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(taxes.id, id));

    await audit.log(
      {
        action: "tax.update",
        entityType: "tax",
        entityId: id,
        actorId: actor.userId,
        before: Object.fromEntries(changed.map((field) => [field, current[field]])),
        after: Object.fromEntries(changed.map((field) => [field, next[field]])),
      },
      tx,
    );

    return requireTax(tx, id);
  });
}

export async function createTaxRate(
  actor: AuthContext,
  taxId: string,
  input: CreateTaxRateInput,
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.taxes.manage");

  return inTx(externalTx, async (tx) => {
    const [tax] = await tx
      .select({ id: taxes.id })
      .from(taxes)
      .where(eq(taxes.id, taxId))
      .for("update")
      .limit(1);
    if (!tax) throw notFound("Pajak tidak ditemukan.");

    const [dup] = await tx
      .select({ id: taxRates.id })
      .from(taxRates)
      .where(and(eq(taxRates.taxId, taxId), eq(taxRates.effectiveFrom, input.effectiveFrom)))
      .limit(1);
    if (dup) {
      throw conflict("Sudah ada tarif dengan tanggal efektif yang sama untuk pajak ini.");
    }

    const values = {
      taxId,
      rate: input.rate,
      effectiveFrom: input.effectiveFrom,
      source: input.source,
      note: input.note ?? null,
    };

    const [created] = await tx
      .insert(taxRates)
      .values({ ...values, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: taxRates.id });
    if (!created) throw new Error("Gagal membuat tarif pajak.");

    await audit.log(
      {
        action: "tax_rate.create",
        entityType: "tax_rate",
        entityId: created.id,
        actorId: actor.userId,
        after: values,
      },
      tx,
    );

    const [row] = await tx
      .select(rateColumns)
      .from(taxRates)
      .where(eq(taxRates.id, created.id))
      .limit(1);
    return row ?? null;
  });
}
