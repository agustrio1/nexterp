import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";

import { companySettings, currencies, exchangeRates } from "@/db/schema";
import { toDb } from "@/lib/money";
import type {
  CreateCurrencyInput,
  CreateExchangeRateInput,
  ListCurrenciesQuery,
  ListExchangeRatesQuery,
  UpdateCurrencyInput,
} from "@/modules/organization/finance-schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { businessRule, conflict, forbidden, notFound, validationFailed } from "@/server/errors";
import { toLimitOffset } from "@/server/validation";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "select">;

/** Skala kolom exchange_rates.rate (numeric(18,6)). */
const RATE_DP = 6;

/* ------------------------------------------------------------------ */
/* Helper                                                              */
/* ------------------------------------------------------------------ */

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

const currencyColumns = {
  code: currencies.code,
  name: currencies.name,
  symbol: currencies.symbol,
  decimals: currencies.decimals,
  isActive: currencies.isActive,
  createdAt: currencies.createdAt,
  updatedAt: currencies.updatedAt,
};

const rateColumns = {
  id: exchangeRates.id,
  fromCurrency: exchangeRates.fromCurrency,
  toCurrency: exchangeRates.toCurrency,
  rateDate: exchangeRates.rateDate,
  rate: exchangeRates.rate,
  source: exchangeRates.source,
  createdBy: exchangeRates.createdBy,
  createdAt: exchangeRates.createdAt,
};

type CurrencyRow = Awaited<ReturnType<typeof requireCurrency>>;

function toView(row: CurrencyRow, baseCode: string) {
  return { ...row, isBase: row.code === baseCode };
}

/** Mata uang dasar dibaca dari pengaturan base_currency (hanya-baca lewat API). */
async function getBaseCurrencyCode(reader: Reader): Promise<string> {
  const [row] = await reader
    .select({ value: companySettings.value })
    .from(companySettings)
    .where(eq(companySettings.key, "base_currency"))
    .limit(1);

  const value = row?.value;
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) {
    throw new Error("Pengaturan base_currency tidak ada atau tidak valid.");
  }
  return value;
}

async function requireCurrency(reader: Reader, code: string) {
  const [row] = await reader
    .select(currencyColumns)
    .from(currencies)
    .where(eq(currencies.code, code))
    .limit(1);
  if (!row) throw notFound("Mata uang tidak ditemukan.");
  return row;
}

/** Mengunci baris mata uang (FOR UPDATE) selama transaksi. */
async function lockCurrency(tx: Tx, code: string) {
  const [row] = await tx
    .select(currencyColumns)
    .from(currencies)
    .where(eq(currencies.code, code))
    .for("update");
  if (!row) throw notFound("Mata uang tidak ditemukan.");
  return row;
}

/** Mengunci FOR SHARE agar penonaktifan mata uang menunggu transaksi ini. */
async function lockCurrencyShared(tx: Tx, code: string) {
  const [row] = await tx
    .select({ code: currencies.code, isActive: currencies.isActive })
    .from(currencies)
    .where(eq(currencies.code, code))
    .for("share");
  return row;
}

/* ------------------------------------------------------------------ */
/* Mata uang                                                           */
/* ------------------------------------------------------------------ */

export async function listCurrencies(actor: AuthContext, query: ListCurrenciesQuery = {}) {
  assertCan(actor, "core.currencies.read");

  const [rows, baseCode] = await Promise.all([
    db
      .select(currencyColumns)
      .from(currencies)
      .where(query.isActive === undefined ? undefined : eq(currencies.isActive, query.isActive))
      .orderBy(asc(currencies.code)),
    getBaseCurrencyCode(db),
  ]);

  return rows.map((row) => toView(row, baseCode));
}

export async function getCurrency(actor: AuthContext, code: string) {
  assertCan(actor, "core.currencies.read");

  const [row, baseCode] = await Promise.all([
    requireCurrency(db, normalizeCode(code)),
    getBaseCurrencyCode(db),
  ]);
  return toView(row, baseCode);
}

export async function createCurrency(actor: AuthContext, input: CreateCurrencyInput) {
  assertCan(actor, "core.currencies.manage");

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ code: currencies.code })
      .from(currencies)
      .where(eq(currencies.code, input.code))
      .limit(1);
    if (existing) throw conflict("Kode mata uang sudah dipakai.");

    const values = {
      code: input.code,
      name: input.name,
      symbol: input.symbol ?? null,
      decimals: input.decimals,
    };

    await tx.insert(currencies).values({ ...values, isActive: true });

    await audit.log(
      {
        action: "currency.create",
        entityType: "currency",
        entityId: input.code,
        actorId: actor.userId,
        after: values,
      },
      tx,
    );

    const [created, baseCode] = await Promise.all([
      requireCurrency(tx, input.code),
      getBaseCurrencyCode(tx),
    ]);
    return toView(created, baseCode);
  });
}

const UPDATABLE_CURRENCY_FIELDS = ["name", "symbol", "decimals", "isActive"] as const;

export async function updateCurrency(actor: AuthContext, code: string, input: UpdateCurrencyInput) {
  assertCan(actor, "core.currencies.manage");
  const normalized = normalizeCode(code);

  return db.transaction(async (tx) => {
    const current = await lockCurrency(tx, normalized);
    const baseCode = await getBaseCurrencyCode(tx);

    const next = {
      name: input.name ?? current.name,
      symbol: input.symbol === undefined ? current.symbol : input.symbol,
      decimals: input.decimals ?? current.decimals,
      isActive: input.isActive ?? current.isActive,
    };

    const changedFields = UPDATABLE_CURRENCY_FIELDS.filter(
      (field) => next[field] !== current[field],
    );
    if (changedFields.length === 0) return toView(current, baseCode);

    if (current.code === baseCode) {
      if (!next.isActive) {
        throw businessRule("Mata uang dasar tidak dapat dinonaktifkan.");
      }
      if (next.decimals !== current.decimals) {
        throw businessRule("Jumlah desimal mata uang dasar tidak dapat diubah.");
      }
    }

    await tx
      .update(currencies)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(currencies.code, normalized));

    await audit.log(
      {
        action: "currency.update",
        entityType: "currency",
        entityId: normalized,
        actorId: actor.userId,
        before: Object.fromEntries(changedFields.map((field) => [field, current[field]])),
        after: Object.fromEntries(changedFields.map((field) => [field, next[field]])),
      },
      tx,
    );

    return toView(await requireCurrency(tx, normalized), baseCode);
  });
}

/* ------------------------------------------------------------------ */
/* Kurs                                                                */
/* ------------------------------------------------------------------ */

export async function listExchangeRates(actor: AuthContext, query: ListExchangeRatesQuery) {
  assertCan(actor, "core.exchange_rates.read");

  const where = and(
    query.fromCurrency === undefined ? undefined : eq(exchangeRates.fromCurrency, query.fromCurrency),
    query.dateFrom === undefined ? undefined : gte(exchangeRates.rateDate, query.dateFrom),
    query.dateTo === undefined ? undefined : lte(exchangeRates.rateDate, query.dateTo),
  );
  const { limit, offset } = toLimitOffset(query);

  const [items, [countRow]] = await Promise.all([
    db
      .select(rateColumns)
      .from(exchangeRates)
      .where(where)
      .orderBy(desc(exchangeRates.rateDate), asc(exchangeRates.fromCurrency))
      .limit(limit)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(exchangeRates).where(where),
  ]);

  return { items, total: countRow?.total ?? 0, page: query.page, pageSize: query.pageSize };
}

/**
 * Kurs bersifat immutable: 1 satuan fromCurrency = rate satuan mata uang dasar.
 * Koreksi dilakukan dengan kurs pada tanggal lain, bukan dengan menimpa.
 */
export async function createExchangeRate(actor: AuthContext, input: CreateExchangeRateInput) {
  assertCan(actor, "core.exchange_rates.manage");

  return db.transaction(async (tx) => {
    const baseCode = await getBaseCurrencyCode(tx);

    const from = await lockCurrencyShared(tx, input.fromCurrency);
    if (!from) {
      throw validationFailed([{ path: "fromCurrency", message: "Mata uang tidak ditemukan." }]);
    }
    if (from.code === baseCode) {
      throw businessRule("Mata uang asal tidak boleh sama dengan mata uang dasar.");
    }
    if (!from.isActive) {
      throw businessRule("Mata uang tidak aktif.");
    }

    const base = await lockCurrencyShared(tx, baseCode);
    if (!base) {
      throw new Error("Mata uang dasar tidak ada pada tabel mata uang.");
    }

    const [duplicate] = await tx
      .select({ id: exchangeRates.id })
      .from(exchangeRates)
      .where(
        and(
          eq(exchangeRates.fromCurrency, from.code),
          eq(exchangeRates.toCurrency, baseCode),
          eq(exchangeRates.rateDate, input.rateDate),
        ),
      )
      .limit(1);
    if (duplicate) {
      throw conflict("Kurs untuk tanggal tersebut sudah ada. Kurs tidak dapat diubah; gunakan tanggal lain.");
    }

    const values = {
      fromCurrency: from.code,
      toCurrency: baseCode,
      rateDate: input.rateDate,
      rate: toDb(input.rate, RATE_DP),
      source: input.source ?? null,
    };

    const [created] = await tx
      .insert(exchangeRates)
      .values({ ...values, createdBy: actor.userId })
      .returning(rateColumns);
    if (!created) throw new Error("Gagal membuat kurs.");

    await audit.log(
      {
        action: "exchange_rate.create",
        entityType: "exchange_rate",
        entityId: created.id,
        actorId: actor.userId,
        after: values,
      },
      tx,
    );

    return created;
  });
}

/**
 * Menyelesaikan kurs konversi 1 satuan `fromCurrency` ke mata uang dasar pada
 * `date` (YYYY-MM-DD). Kurs bersifat historis: bila tidak ada baris tepat pada
 * tanggal itu, dipakai kurs terakhir dengan `rateDate <= date`. Untuk mata uang
 * dasar sendiri nilainya 1. Dipakai modul purchasing (5F/5G) untuk memotret
 * kurs ke dalam dokumen. Melempar BUSINESS_RULE bila tidak ada kurs sama sekali.
 */
export async function resolveRateToBase(
  reader: Reader,
  fromCurrency: string,
  date: string,
): Promise<{ rate: string; baseCode: string }> {
  const baseCode = await getBaseCurrencyCode(reader);
  const code = normalizeCode(fromCurrency);

  if (code === baseCode) {
    return { rate: toDb(1, RATE_DP), baseCode };
  }

  const [row] = await reader
    .select({ rate: exchangeRates.rate })
    .from(exchangeRates)
    .where(
      and(
        eq(exchangeRates.fromCurrency, code),
        eq(exchangeRates.toCurrency, baseCode),
        lte(exchangeRates.rateDate, date),
      ),
    )
    .orderBy(desc(exchangeRates.rateDate), desc(exchangeRates.id))
    .limit(1);

  if (!row) {
    throw businessRule(
      `Kurs ${code} ke ${baseCode} belum tersedia untuk tanggal ${date} atau sebelumnya.`,
    );
  }
  return { rate: row.rate, baseCode };
}