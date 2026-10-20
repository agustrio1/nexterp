import { and, asc, desc, eq, gt, gte, lt, lte, sql } from "drizzle-orm";

import { accountingPeriods, fiscalYears, journalEntries } from "@/db/schema";
import type {
  ChangePeriodStatusInput,
  CreateFiscalYearInput,
  ListFiscalYearsQuery,
} from "@/modules/organization/finance-schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { businessRule, conflict, forbidden, notFound, validationFailed } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "select">;

/** Tingkat penutupan; dalam satu tahun fiskal tidak boleh menurun searah waktu. */
const RANK = { open: 0, soft_closed: 1, closed: 2 } as const;
type PeriodStatus = keyof typeof RANK;

const STATUS_LABEL: Record<PeriodStatus, string> = {
  open: "terbuka",
  soft_closed: "ditutup sementara",
  closed: "ditutup",
};

/* ------------------------------------------------------------------ */
/* Helper                                                              */
/* ------------------------------------------------------------------ */

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

/**
 * Menjalankan `fn` dalam transaksi baru (default) atau memakai `tx` eksternal bila
 * diberikan. Memungkinkan skrip uji membungkus pembuatan tahun + perubahan periode
 * + jurnal dalam SATU transaksi dengan rollback.
 */
async function inTx<T>(externalTx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (externalTx) return fn(externalTx);
  return db.transaction(fn);
}

const yearColumns = {
  id: fiscalYears.id,
  code: fiscalYears.code,
  startDate: fiscalYears.startDate,
  endDate: fiscalYears.endDate,
  status: fiscalYears.status,
  closedAt: fiscalYears.closedAt,
  closedBy: fiscalYears.closedBy,
  createdAt: fiscalYears.createdAt,
  updatedAt: fiscalYears.updatedAt,
};

const periodColumns = {
  id: accountingPeriods.id,
  fiscalYearId: accountingPeriods.fiscalYearId,
  periodNo: accountingPeriods.periodNo,
  startDate: accountingPeriods.startDate,
  endDate: accountingPeriods.endDate,
  status: accountingPeriods.status,
  closedAt: accountingPeriods.closedAt,
  closedBy: accountingPeriods.closedBy,
  createdAt: accountingPeriods.createdAt,
  updatedAt: accountingPeriods.updatedAt,
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Rentang bulan kalender penuh dari startDate sampai endDate (keduanya sudah selaras bulan). */
function monthRanges(startDate: string, endDate: string): { start: string; end: string }[] {
  const [sy = 0, sm = 0] = startDate.split("-").map(Number);
  const [ey = 0, em = 0] = endDate.split("-").map(Number);
  const total = (ey - sy) * 12 + (em - sm) + 1;

  const ranges: { start: string; end: string }[] = [];
  for (let i = 0; i < total; i++) {
    const monthIndex = sm - 1 + i;
    const year = sy + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

    ranges.push({
      start: `${year}-${pad2(month)}-01`,
      end: `${year}-${pad2(month)}-${pad2(lastDay)}`,
    });
  }
  return ranges;
}

async function loadFiscalYearDetail(reader: Reader, id: string) {
  const [year] = await reader
    .select(yearColumns)
    .from(fiscalYears)
    .where(eq(fiscalYears.id, id))
    .limit(1);
  if (!year) throw notFound("Tahun fiskal tidak ditemukan.");

  const periods = await reader
    .select(periodColumns)
    .from(accountingPeriods)
    .where(eq(accountingPeriods.fiscalYearId, id))
    .orderBy(asc(accountingPeriods.periodNo));

  return { ...year, periods };
}

async function requirePeriod(reader: Reader, id: string) {
  const [period] = await reader
    .select(periodColumns)
    .from(accountingPeriods)
    .where(eq(accountingPeriods.id, id))
    .limit(1);
  if (!period) throw notFound("Periode tidak ditemukan.");
  return period;
}

/** Mengunci baris periode (FOR UPDATE) selama transaksi. */
async function lockPeriod(tx: Tx, id: string) {
  const [period] = await tx
    .select(periodColumns)
    .from(accountingPeriods)
    .where(eq(accountingPeriods.id, id))
    .for("update");
  if (!period) throw notFound("Periode tidak ditemukan.");
  return period;
}

/* ------------------------------------------------------------------ */
/* Baca                                                                */
/* ------------------------------------------------------------------ */

export async function listFiscalYears(actor: AuthContext, query: ListFiscalYearsQuery = {}) {
  assertCan(actor, "core.fiscal_years.read");

  return db
    .select(yearColumns)
    .from(fiscalYears)
    .where(query.status === undefined ? undefined : eq(fiscalYears.status, query.status))
    .orderBy(desc(fiscalYears.startDate));
}

/** Detail tahun fiskal beserta seluruh periodenya. Izin: tahun fiskal dan periode (baca). */
export async function getFiscalYear(actor: AuthContext, id: string) {
  assertCan(actor, "core.fiscal_years.read");
  assertCan(actor, "core.periods.read");
  return loadFiscalYearDetail(db, id);
}

/* ------------------------------------------------------------------ */
/* Tulis                                                               */
/* ------------------------------------------------------------------ */

export async function createFiscalYear(
  actor: AuthContext,
  input: CreateFiscalYearInput,
  externalTx?: Tx,
) {
  assertCan(actor, "core.fiscal_years.manage");

  return inTx(externalTx, async (tx) => {
    // Pemeriksaan tumpang tindih diserialkan agar dua pembuatan bersamaan tidak bisa sama-sama lolos.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('erp.fiscal_years.range'))`);

    const [sameCode] = await tx
      .select({ id: fiscalYears.id })
      .from(fiscalYears)
      .where(eq(fiscalYears.code, input.code))
      .limit(1);
    if (sameCode) throw conflict("Kode tahun fiskal sudah dipakai.");

    const [overlap] = await tx
      .select({ code: fiscalYears.code })
      .from(fiscalYears)
      .where(and(lte(fiscalYears.startDate, input.endDate), gte(fiscalYears.endDate, input.startDate)))
      .limit(1);
    if (overlap) {
      throw businessRule(`Rentang tanggal tumpang tindih dengan tahun fiskal ${overlap.code}.`);
    }

    const [created] = await tx
      .insert(fiscalYears)
      .values({
        code: input.code,
        startDate: input.startDate,
        endDate: input.endDate,
        status: "open",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: fiscalYears.id });
    if (!created) throw new Error("Gagal membuat tahun fiskal.");

    const periodRows = monthRanges(input.startDate, input.endDate).map((range, index) => ({
      fiscalYearId: created.id,
      periodNo: index + 1,
      startDate: range.start,
      endDate: range.end,
      status: "open" as const,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    }));

    if (input.includeAdjustmentPeriod) {
      // Periode penyesuaian akhir tahun: boleh berbagi tanggal dengan periode terakhir.
      periodRows.push({
        fiscalYearId: created.id,
        periodNo: 13,
        startDate: input.endDate,
        endDate: input.endDate,
        status: "open" as const,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      });
    }

    await tx.insert(accountingPeriods).values(periodRows);

    await audit.log(
      {
        action: "fiscal_year.create",
        entityType: "fiscal_year",
        entityId: created.id,
        actorId: actor.userId,
        after: {
          code: input.code,
          startDate: input.startDate,
          endDate: input.endDate,
          periodCount: periodRows.length,
          adjustmentPeriod: input.includeAdjustmentPeriod,
        },
      },
      tx,
    );

    return loadFiscalYearDetail(tx, created.id);
  });
}

/**
 * Mengubah status periode. Menaikkan tingkat (open -> soft_closed -> closed) membutuhkan
 * core.periods.close; menurunkan membutuhkan core.periods.reopen dan alasan.
 * Invarian: dalam satu tahun fiskal, tingkat periode N tidak boleh lebih rendah dari periode N+1.
 *
 * Titik pemasangan Tahap 4: pemeriksaan jurnal draf dan urutan antar tahun fiskal
 * ditambahkan di sini, sebelum pembaruan, untuk arah "naik".
 */
export async function changePeriodStatus(
  actor: AuthContext,
  periodId: string,
  input: ChangePeriodStatusInput,
  externalTx?: Tx,
) {
  const mayClose = can(actor.grants, "core.periods.close");
  const mayReopen = can(actor.grants, "core.periods.reopen");
  if (!mayClose && !mayReopen) throw forbidden();

  return inTx(externalTx, async (tx) => {
    // Pemeriksaan tetangga diserialkan agar dua perubahan pada periode bersebelahan tidak
    // bisa sama-sama lolos lalu melanggar invarian.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('erp.periods.status'))`);

    const period = await lockPeriod(tx, periodId);
    const target = input.status;

    if (period.status === target) return period;

    const goingUp = RANK[target] > RANK[period.status];
    if (goingUp && !mayClose) {
      throw forbidden("Anda tidak memiliki izin untuk menutup periode.");
    }
    if (!goingUp && !mayReopen) {
      throw forbidden("Anda tidak memiliki izin untuk membuka kembali periode.");
    }
    if (!goingUp && !input.reason) {
      throw validationFailed([
        { path: "reason", message: "Alasan wajib diisi untuk membuka kembali periode." },
      ]);
    }

    const [year] = await tx
      .select({ code: fiscalYears.code, status: fiscalYears.status })
      .from(fiscalYears)
      .where(eq(fiscalYears.id, period.fiscalYearId))
      .limit(1);
    if (!year) throw new Error("Tahun fiskal periode tidak ditemukan.");
    if (year.status === "closed") {
      throw businessRule("Tahun fiskal sudah ditutup; periodenya tidak dapat diubah.");
    }

    const [previous] = await tx
      .select({ periodNo: accountingPeriods.periodNo, status: accountingPeriods.status })
      .from(accountingPeriods)
      .where(
        and(
          eq(accountingPeriods.fiscalYearId, period.fiscalYearId),
          lt(accountingPeriods.periodNo, period.periodNo),
        ),
      )
      .orderBy(desc(accountingPeriods.periodNo))
      .limit(1);

    const [following] = await tx
      .select({ periodNo: accountingPeriods.periodNo, status: accountingPeriods.status })
      .from(accountingPeriods)
      .where(
        and(
          eq(accountingPeriods.fiscalYearId, period.fiscalYearId),
          gt(accountingPeriods.periodNo, period.periodNo),
        ),
      )
      .orderBy(asc(accountingPeriods.periodNo))
      .limit(1);

    if (previous && RANK[previous.status] < RANK[target]) {
      throw businessRule(
        `Periode ${previous.periodNo} harus berstatus minimal ${STATUS_LABEL[target]}.`,
      );
    }
    if (following && RANK[following.status] > RANK[target]) {
      throw businessRule(`Periode ${following.periodNo} harus dibuka kembali lebih dulu.`);
    }

    // 4F: menutup periode (naik tingkat) diblokir bila masih ada jurnal draf dalam rentangnya.
    if (goingUp) {
      const [draft] = await tx
        .select({ id: journalEntries.id, docNo: journalEntries.docNo })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.status, "draft"),
            gte(journalEntries.entryDate, period.startDate),
            lte(journalEntries.entryDate, period.endDate),
          ),
        )
        .limit(1);
      if (draft) {
        throw businessRule(
          "Masih ada jurnal berstatus draft dalam periode ini; posting atau batalkan lebih dulu.",
        );
      }
    }

    const closing = target !== "open";
    await tx
      .update(accountingPeriods)
      .set({
        status: target,
        closedAt: closing ? new Date() : null,
        closedBy: closing ? actor.userId : null,
        updatedBy: actor.userId,
        updatedAt: new Date(),
      })
      .where(eq(accountingPeriods.id, periodId));

    await audit.log(
      {
        action: goingUp ? "period.close" : "period.reopen",
        entityType: "accounting_period",
        entityId: periodId,
        actorId: actor.userId,
        before: { status: period.status },
        after: {
          status: target,
          reason: input.reason ?? null,
          fiscalYear: year.code,
          periodNo: period.periodNo,
        },
      },
      tx,
    );

    return requirePeriod(tx, periodId);
  });
}