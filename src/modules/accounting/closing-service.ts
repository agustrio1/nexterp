import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";

import {
  accountingPeriods,
  chartAccounts,
  companySettings,
  fiscalYears,
  journalEntries,
  journalEntryLines,
} from "@/db/schema";
import { cmp, dec, toDb, type Money } from "@/lib/money";
import type {
  CreateClosingEntryInput,
  CreateOpeningBalanceInput,
} from "@/modules/accounting/closing-schemas";
import { createSystemDraft } from "@/modules/accounting/journal-service";
import type { JournalLineInput } from "@/modules/accounting/schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { businessRule, conflict, forbidden, notFound } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Kunci sumber untuk jurnal khusus 4F. */
const SOURCE_OPENING = "opening_balance";
const SOURCE_CLOSING = "closing_entry";
const SETTING_RETAINED = "retained_earnings_account_id";

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

const fiscalYearColumns = {
  id: fiscalYears.id,
  code: fiscalYears.code,
  startDate: fiscalYears.startDate,
  endDate: fiscalYears.endDate,
  status: fiscalYears.status,
  closedAt: fiscalYears.closedAt,
  closedBy: fiscalYears.closedBy,
};

async function requireFiscalYear(tx: Tx, id: string) {
  const [year] = await tx
    .select(fiscalYearColumns)
    .from(fiscalYears)
    .where(eq(fiscalYears.id, id))
    .limit(1);
  if (!year) throw notFound("Tahun fiskal tidak ditemukan.");
  return year;
}

/** Periode yang memuat tanggal tertentu dalam tahun fiskal. */
async function periodCovering(tx: Tx, fiscalYearId: string, date: string) {
  const [period] = await tx
    .select({
      id: accountingPeriods.id,
      periodNo: accountingPeriods.periodNo,
      startDate: accountingPeriods.startDate,
      endDate: accountingPeriods.endDate,
      status: accountingPeriods.status,
    })
    .from(accountingPeriods)
    .where(
      and(
        eq(accountingPeriods.fiscalYearId, fiscalYearId),
        lte(accountingPeriods.startDate, date),
        gte(accountingPeriods.endDate, date),
      ),
    )
    .orderBy(asc(accountingPeriods.periodNo))
    .limit(1);
  return period;
}

/** Sudah ada jurnal AKTIF (draft/posted) untuk sumber tertentu? (dedup per tahun). */
async function hasActiveSource(tx: Tx, sourceType: string, sourceId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.sourceType, sourceType),
        eq(journalEntries.sourceId, sourceId),
        inArray(journalEntries.status, ["draft", "posted"]),
      ),
    )
    .limit(1);
  return !!row;
}

async function readSetting(tx: Tx, key: string): Promise<unknown> {
  const [row] = await tx
    .select({ value: companySettings.value })
    .from(companySettings)
    .where(eq(companySettings.key, key))
    .limit(1);
  return row?.value;
}

/* ------------------------------------------------------------------ */
/* Saldo awal (opening balance)                                        */
/* ------------------------------------------------------------------ */

export async function createOpeningBalanceDraft(
  actor: AuthContext,
  input: CreateOpeningBalanceInput,
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.opening.manage");

  const run = async (tx: Tx) => {
    const year = await requireFiscalYear(tx, input.fiscalYearId);

    if (await hasActiveSource(tx, SOURCE_OPENING, year.id)) {
      throw conflict("Saldo awal untuk tahun fiskal ini sudah ada (draf atau terposting).");
    }

    return createSystemDraft(tx, actor, {
      entryDate: year.startDate,
      description: input.description,
      reference: input.reference ?? null,
      lines: input.lines,
      sourceType: SOURCE_OPENING,
      sourceId: year.id,
      sourceEvent: SOURCE_OPENING,
      idempotencyKey: input.idempotencyKey,
    });
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

/* ------------------------------------------------------------------ */
/* Jurnal penutup (closing entry)                                      */
/* ------------------------------------------------------------------ */

type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
interface TempBalance {
  accountId: string;
  code: string;
  type: AccountType;
  debit: string;
  credit: string;
}

async function computeTempBalances(tx: Tx, from: string, to: string): Promise<TempBalance[]> {
  return tx
    .select({
      accountId: journalEntryLines.accountId,
      code: chartAccounts.code,
      type: chartAccounts.type,
      debit: sql<string>`coalesce(sum(${journalEntryLines.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${journalEntryLines.credit}), 0)`,
    })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.entryId))
    .innerJoin(chartAccounts, eq(chartAccounts.id, journalEntryLines.accountId))
    .where(
      and(
        inArray(journalEntries.status, ["posted", "reversed"]),
        gte(journalEntries.entryDate, from),
        lte(journalEntries.entryDate, to),
        inArray(chartAccounts.type, ["revenue", "expense"]),
      ),
    )
    .groupBy(journalEntryLines.accountId, chartAccounts.type, chartAccounts.code)
    .orderBy(asc(chartAccounts.code));
}

export async function createClosingEntryDraft(
  actor: AuthContext,
  input: CreateClosingEntryInput,
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.closing.manage");

  const run = async (tx: Tx) => {
    const year = await requireFiscalYear(tx, input.fiscalYearId);
    if (year.status === "closed") {
      throw businessRule("Tahun fiskal sudah ditutup.");
    }

    const retainedAccountIdRaw = await readSetting(tx, SETTING_RETAINED);
    if (typeof retainedAccountIdRaw !== "string" || retainedAccountIdRaw === "") {
      throw businessRule(
        "Akun laba ditahan belum diatur (retained_earnings_account_id). Isi pengaturan perusahaan lebih dulu.",
      );
    }

    if (await hasActiveSource(tx, SOURCE_CLOSING, year.id)) {
      throw conflict("Jurnal penutup untuk tahun fiskal ini sudah ada (draf atau terposting).");
    }

    // Jurnal penutup jatuh pada akhir tahun; periode tersebut harus tersedia & belum final.
    const endPeriod = await periodCovering(tx, year.id, year.endDate);
    if (!endPeriod) {
      throw businessRule("Tidak ada periode yang memuat tanggal akhir tahun fiskal.");
    }
    if (endPeriod.status === "closed") {
      throw businessRule("Periode akhir tahun sudah ditutup; buka kembali sebelum membuat jurnal penutup.");
    }

    const balances = await computeTempBalances(tx, year.startDate, year.endDate);
    const lines: JournalLineInput[] = [];
    let netIncome: Money = dec(0);

    for (const row of balances) {
      if (row.type === "revenue") {
        const net = dec(row.credit).minus(dec(row.debit)); // saldo normal kredit
        if (cmp(net, 0) > 0) {
          lines.push({ accountId: row.accountId, side: "debit", amount: toDb(net) });
        } else if (cmp(net, 0) < 0) {
          lines.push({ accountId: row.accountId, side: "credit", amount: toDb(net.times(-1)) });
        } else {
          continue;
        }
        netIncome = netIncome.plus(net);
      } else {
        const net = dec(row.debit).minus(dec(row.credit)); // saldo normal debit
        if (cmp(net, 0) > 0) {
          lines.push({ accountId: row.accountId, side: "credit", amount: toDb(net) });
        } else if (cmp(net, 0) < 0) {
          lines.push({ accountId: row.accountId, side: "debit", amount: toDb(net.times(-1)) });
        } else {
          continue;
        }
        netIncome = netIncome.minus(net);
      }
    }

    if (lines.length === 0) {
      throw businessRule("Tidak ada saldo pendapatan/beban untuk ditutup pada tahun ini.");
    }

    // Selisih ditampung ke akun laba ditahan (kredit bila laba, debit bila rugi).
    if (cmp(netIncome, 0) > 0) {
      lines.push({ accountId: retainedAccountIdRaw, side: "credit", amount: toDb(netIncome) });
    } else if (cmp(netIncome, 0) < 0) {
      lines.push({
        accountId: retainedAccountIdRaw,
        side: "debit",
        amount: toDb(netIncome.times(-1)),
      });
    }

    return createSystemDraft(tx, actor, {
      entryDate: year.endDate,
      description: input.description ?? `Jurnal penutup tahun fiskal ${year.code}`,
      reference: input.reference ?? null,
      lines,
      sourceType: SOURCE_CLOSING,
      sourceId: year.id,
      sourceEvent: SOURCE_CLOSING,
    });
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

/* ------------------------------------------------------------------ */
/* Penutupan tahun fiskal                                              */
/* ------------------------------------------------------------------ */

export async function closeFiscalYear(actor: AuthContext, fiscalYearId: string, externalTx?: Tx) {
  assertCan(actor, "accounting.closing.manage");

  const run = async (tx: Tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('erp.fiscal_years.close'))`);

    const [locked] = await tx
      .select(fiscalYearColumns)
      .from(fiscalYears)
      .where(eq(fiscalYears.id, fiscalYearId))
      .for("update")
      .limit(1);
    if (!locked) throw notFound("Tahun fiskal tidak ditemukan.");
    if (locked.status === "closed") return locked; // idempotent

    // Jurnal penutup harus sudah terposting.
    const [closing] = await tx
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.sourceType, SOURCE_CLOSING),
          eq(journalEntries.sourceId, locked.id),
          eq(journalEntries.status, "posted"),
        ),
      )
      .limit(1);
    if (!closing) {
      throw businessRule("Jurnal penutup belum diposting; posting lebih dulu sebelum menutup tahun.");
    }

    // Seluruh periode harus sudah ditutup.
    const [openPeriod] = await tx
      .select({ periodNo: accountingPeriods.periodNo, status: accountingPeriods.status })
      .from(accountingPeriods)
      .where(
        and(
          eq(accountingPeriods.fiscalYearId, locked.id),
          sql`${accountingPeriods.status} <> 'closed'`,
        ),
      )
      .orderBy(asc(accountingPeriods.periodNo))
      .limit(1);
    if (openPeriod) {
      throw businessRule(
        `Periode ${openPeriod.periodNo} belum ditutup (status: ${openPeriod.status}).`,
      );
    }

    // Tahun fiskal sebelumnya (berdasarkan tanggal) harus sudah ditutup (urutan antar-tahun).
    const [previous] = await tx
      .select({ code: fiscalYears.code, status: fiscalYears.status })
      .from(fiscalYears)
      .where(lt(fiscalYears.endDate, locked.startDate))
      .orderBy(desc(fiscalYears.endDate))
      .limit(1);
    if (previous && previous.status !== "closed") {
      throw businessRule(`Tahun fiskal ${previous.code} harus ditutup lebih dulu.`);
    }

    const now = new Date();
    await tx
      .update(fiscalYears)
      .set({ status: "closed", closedAt: now, closedBy: actor.userId, updatedAt: now, updatedBy: actor.userId })
      .where(eq(fiscalYears.id, locked.id));

    await audit.log(
      {
        action: "fiscal_year.close",
        entityType: "fiscal_year",
        entityId: locked.id,
        actorId: actor.userId,
        before: { status: locked.status },
        after: { status: "closed", code: locked.code, closingEntryId: closing?.id ?? null },
      },
      tx,
    );

    const [after] = await tx
      .select(fiscalYearColumns)
      .from(fiscalYears)
      .where(eq(fiscalYears.id, locked.id))
      .limit(1);
    return after;
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

/* Baca bantu: daftar periode suatu tahun (untuk UI / pemeriksaan). */
export async function listFiscalYearPeriods(tx: Tx, fiscalYearId: string) {
  return tx
    .select({
      id: accountingPeriods.id,
      periodNo: accountingPeriods.periodNo,
      startDate: accountingPeriods.startDate,
      endDate: accountingPeriods.endDate,
      status: accountingPeriods.status,
    })
    .from(accountingPeriods)
    .where(eq(accountingPeriods.fiscalYearId, fiscalYearId))
    .orderBy(asc(accountingPeriods.periodNo));
}

/* Menjaga agar helper baca periode tetap terekspos untuk modul lain. */
export type { TempBalance };
