import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import {
  accountingPeriods,
  branches,
  chartAccounts,
  costCenters,
  departments,
  journalEntries,
  journalEntryLines,
} from "@/db/schema";
import { sum, toDb } from "@/lib/money";
import type {
  CancelJournalInput,
  CreateJournalInput,
  JournalLineInput,
  ListJournalsQuery,
  ReverseJournalInput,
  UpdateJournalInput,
} from "@/modules/accounting/schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { businessRule, conflict, forbidden, notFound, validationFailed } from "@/server/errors";
import { nextDocumentNumber } from "@/server/numbering";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const DEFAULT_LIST_LIMIT = 50;

/**
 * Menjalankan `fn` di dalam transaksi baru (default) atau di dalam `tx` eksternal
 * bila diberikan. Pola ini dipakai agar skrip uji dapat membungkus beberapa operasi
 * menjadi SATU transaksi dengan rollback di akhir sehingga GL tidak tercemar.
 */
async function inTx<T>(
  externalTx: Tx | undefined,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (externalTx) return fn(externalTx);
  return db.transaction(fn);
}

/* ------------------------------------------------------------------ */
/* Helper umum                                                         */
/* ------------------------------------------------------------------ */

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

const journalHeaderColumns = {
  id: journalEntries.id,
  docNo: journalEntries.docNo,
  entryDate: journalEntries.entryDate,
  periodId: journalEntries.periodId,
  status: journalEntries.status,
  description: journalEntries.description,
  reference: journalEntries.reference,
  sourceType: journalEntries.sourceType,
  sourceId: journalEntries.sourceId,
  sourceEvent: journalEntries.sourceEvent,
  reversalOfId: journalEntries.reversalOfId,
  totalDebit: journalEntries.totalDebit,
  totalCredit: journalEntries.totalCredit,
  postedAt: journalEntries.postedAt,
  postedBy: journalEntries.postedBy,
  cancelledAt: journalEntries.cancelledAt,
  cancelledBy: journalEntries.cancelledBy,
  reason: journalEntries.reason,
  idempotencyKey: journalEntries.idempotencyKey,
  createdAt: journalEntries.createdAt,
  updatedAt: journalEntries.updatedAt,
  createdBy: journalEntries.createdBy,
  updatedBy: journalEntries.updatedBy,
};

const journalLineColumns = {
  id: journalEntryLines.id,
  entryId: journalEntryLines.entryId,
  lineNo: journalEntryLines.lineNo,
  accountId: journalEntryLines.accountId,
  accountCode: chartAccounts.code,
  accountName: chartAccounts.name,
  debit: journalEntryLines.debit,
  credit: journalEntryLines.credit,
  memo: journalEntryLines.memo,
  branchId: journalEntryLines.branchId,
  departmentId: journalEntryLines.departmentId,
  costCenterId: journalEntryLines.costCenterId,
};

async function loadHeader(reader: Tx, id: string) {
  const [row] = await reader
    .select(journalHeaderColumns)
    .from(journalEntries)
    .where(eq(journalEntries.id, id))
    .limit(1);
  return row;
}

/** Mengunci header FOR UPDATE (posting/konkurensi). */
async function lockHeader(tx: Tx, id: string) {
  const [row] = await tx
    .select(journalHeaderColumns)
    .from(journalEntries)
    .where(eq(journalEntries.id, id))
    .for("update")
    .limit(1);
  if (!row) throw notFound("Jurnal tidak ditemukan.");
  return row;
}

async function requireHeader(reader: Tx, id: string) {
  const row = await loadHeader(reader, id);
  if (!row) throw notFound("Jurnal tidak ditemukan.");
  return row;
}

async function loadLines(tx: Tx, entryId: string) {
  return tx
    .select(journalLineColumns)
    .from(journalEntryLines)
    .innerJoin(chartAccounts, eq(chartAccounts.id, journalEntryLines.accountId))
    .where(eq(journalEntryLines.entryId, entryId))
    .orderBy(asc(journalEntryLines.lineNo));
}

/**
 * Memeriksa seluruh referensi baris (akun, cabang, departemen) dalam satu
 * transaksi dan mengembalikan daftar error per indeks bila ada yang tidak valid.
 * Akun harus ada, aktif, dan postable; cabang/departemen harus ada dan aktif
 * (hanya diperiksa bila diisi).
 */
async function assertLinesReferenceable(tx: Tx, lines: readonly JournalLineInput[]): Promise<void> {
  const accountIds = [...new Set(lines.map((line) => line.accountId))];
  const branchIds = [...new Set(lines.map((line) => line.branchId).filter((v): v is string => !!v))];
  const departmentIds = [
    ...new Set(lines.map((line) => line.departmentId).filter((v): v is string => !!v)),
  ];
  const costCenterIds = [
    ...new Set(lines.map((line) => line.costCenterId).filter((v): v is string => !!v)),
  ];

  const [accounts, branchRows, departmentRows, costCenterRows] = await Promise.all([
    tx
      .select({
        id: chartAccounts.id,
        code: chartAccounts.code,
        isActive: chartAccounts.isActive,
        isPostable: chartAccounts.isPostable,
      })
      .from(chartAccounts)
      .where(inArray(chartAccounts.id, accountIds)),
    branchIds.length > 0
      ? tx
          .select({ id: branches.id, isActive: branches.isActive })
          .from(branches)
          .where(inArray(branches.id, branchIds))
      : Promise.resolve([] as { id: string; isActive: boolean }[]),
    departmentIds.length > 0
      ? tx
          .select({ id: departments.id, isActive: departments.isActive })
          .from(departments)
          .where(inArray(departments.id, departmentIds))
      : Promise.resolve([] as { id: string; isActive: boolean }[]),
    costCenterIds.length > 0
      ? tx
          .select({ id: costCenters.id, isActive: costCenters.isActive })
          .from(costCenters)
          .where(inArray(costCenters.id, costCenterIds))
      : Promise.resolve([] as { id: string; isActive: boolean }[]),
  ]);

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const branchById = new Map(branchRows.map((b) => [b.id, b]));
  const departmentById = new Map(departmentRows.map((d) => [d.id, d]));
  const costCenterById = new Map(costCenterRows.map((c) => [c.id, c]));

  const issues: { path: string; message: string }[] = [];
  lines.forEach((line, index) => {
    const account = accountById.get(line.accountId);
    if (!account) {
      issues.push({ path: `lines[${index}].accountId`, message: "Akun tidak ditemukan." });
    } else if (!account.isActive) {
      issues.push({
        path: `lines[${index}].accountId`,
        message: `Akun ${account.code} tidak aktif.`,
      });
    } else if (!account.isPostable) {
      issues.push({
        path: `lines[${index}].accountId`,
        message: `Akun ${account.code} bukan akun postable (induk pohon).`,
      });
    }

    if (line.branchId) {
      const branch = branchById.get(line.branchId);
      if (!branch) {
        issues.push({ path: `lines[${index}].branchId`, message: "Cabang tidak ditemukan." });
      } else if (!branch.isActive) {
        issues.push({ path: `lines[${index}].branchId`, message: "Cabang tidak aktif." });
      }
    }

    if (line.departmentId) {
      const department = departmentById.get(line.departmentId);
      if (!department) {
        issues.push({
          path: `lines[${index}].departmentId`,
          message: "Departemen tidak ditemukan.",
        });
      } else if (!department.isActive) {
        issues.push({
          path: `lines[${index}].departmentId`,
          message: "Departemen tidak aktif.",
        });
      }
    }

    if (line.costCenterId) {
      const costCenter = costCenterById.get(line.costCenterId);
      if (!costCenter) {
        issues.push({
          path: `lines[${index}].costCenterId`,
          message: "Pusat biaya tidak ditemukan.",
        });
      } else if (!costCenter.isActive) {
        issues.push({
          path: `lines[${index}].costCenterId`,
          message: "Pusat biaya tidak aktif.",
        });
      }
    }
  });

  if (issues.length > 0) throw validationFailed(issues);
}

/**
 * Menyisipkan seluruh baris jurnal untuk entryId. lineNo diberikan berurutan 1..N.
 * Debit/kredit dipetakan dari `side`; kolom lain tidak boleh diisi karena DB check
 * `journal_entry_lines_amounts_chk` menuntut salah satu sisi nol.
 */
async function insertLines(
  tx: Tx,
  entryId: string,
  lines: readonly JournalLineInput[],
): Promise<void> {
  const values = lines.map((line, index) => ({
    entryId,
    lineNo: index + 1,
    accountId: line.accountId,
    debit: line.side === "debit" ? toDb(line.amount) : "0.00",
    credit: line.side === "credit" ? toDb(line.amount) : "0.00",
    memo: line.memo ?? null,
    branchId: line.branchId ?? null,
    departmentId: line.departmentId ?? null,
    costCenterId: line.costCenterId ?? null,
    createdAt: new Date(),
  }));
  await tx.insert(journalEntryLines).values(values);
}

/** Total header dihitung dari baris; string desimal siap simpan ke numeric(18,2). */
function computeTotals(lines: readonly JournalLineInput[]): { totalDebit: string; totalCredit: string } {
  const debits = lines.filter((l) => l.side === "debit").map((l) => l.amount);
  const credits = lines.filter((l) => l.side === "credit").map((l) => l.amount);
  return { totalDebit: toDb(sum(debits)), totalCredit: toDb(sum(credits)) };
}

/**
 * Memilih periode akuntansi yang memuat entryDate. Periode 13 (penyesuaian)
 * berbagi tanggal dengan periode 12; yang penting hanya satu yang cocok.
 * `FOR SHARE` mencegah penutupan/opens ulang periode paralel saat posting.
 */
async function pickPeriod(tx: Tx, entryDate: string) {
  const [row] = await tx
    .select({
      id: accountingPeriods.id,
      status: accountingPeriods.status,
      startDate: accountingPeriods.startDate,
      endDate: accountingPeriods.endDate,
    })
    .from(accountingPeriods)
    .where(and(lte(accountingPeriods.startDate, entryDate), gte(accountingPeriods.endDate, entryDate)))
    .orderBy(asc(accountingPeriods.startDate))
    .limit(1)
    .for("share");
  return row;
}

/**
 * Inti posting: dipanggil dari `postJournal` (draft manual) dan `reverseJournal`
 * (draf reversal). Semua validasi dilakukan di service; trigger DB adalah
 * penjaga terakhir bila terjadi perubahan konkuren.
 */
async function postInternal(
  tx: Tx,
  actor: AuthContext,
  header: Awaited<ReturnType<typeof loadHeader>>,
): Promise<{ docNo: string; periodId: string; postedAt: Date }> {
  if (header.status !== "draft") {
    throw businessRule(`Hanya jurnal berstatus draft yang dapat diposting (status: ${header.status}).`);
  }

  if (!can(actor.grants, "accounting.journals.post")) {
    throw forbidden("Anda tidak memiliki izin untuk memposting jurnal.");
  }

  // Minimal 2 baris; total aktual dihitung dari baris, bukan dari input.
  const lines = await loadLines(tx, header.id);
  if (lines.length < 2) {
    throw businessRule("Jurnal membutuhkan minimal dua baris untuk diposting.");
  }

  const totalDebit = toDb(
    sum(lines.map((l) => l.debit)),
  );
  const totalCredit = toDb(
    sum(lines.map((l) => l.credit)),
  );

  if (totalDebit !== totalCredit) {
    throw businessRule(
      `Jurnal tidak seimbang: debit ${totalDebit}, kredit ${totalCredit}.`,
    );
  }
  if (totalDebit === "0.00") {
    throw businessRule("Total jurnal harus lebih besar dari nol.");
  }

  // Referensi baris wajib masih valid (akun mungkin dinonaktifkan sejak draf dibuat).
  // `assertLinesReferenceable` memeriksa akun, cabang, dan departemen.
  const asInput: JournalLineInput[] = lines.map((line) => {
    const isDebit = line.debit !== "0.00";
    return {
      accountId: line.accountId,
      side: isDebit ? "debit" : "credit",
      amount: isDebit ? line.debit : line.credit,
      memo: line.memo,
      branchId: line.branchId,
      departmentId: line.departmentId,
      costCenterId: line.costCenterId,
    };
  });
  await assertLinesReferenceable(tx, asInput);

  const period = await pickPeriod(tx, header.entryDate);
  if (!period) {
    throw businessRule(
      `Tidak ada periode akuntansi yang memuat tanggal ${header.entryDate}.`,
    );
  }
  if (period.status === "closed") {
    throw businessRule("Periode akuntansi sudah ditutup; jurnal tidak dapat diposting.");
  }
  if (period.status === "soft_closed") {
    if (!can(actor.grants, "accounting.journals.post_closed_period")) {
      throw forbidden(
        "Periode sedang ditutup sementara; diperlukan izin accounting.journals.post_closed_period.",
      );
    }
  }

  const postedAt = new Date();
  const docNo = await nextDocumentNumber(tx, "journal_entry", { date: header.entryDate });

  await tx
    .update(journalEntries)
    .set({
      status: "posted",
      docNo,
      periodId: period.id,
      totalDebit,
      totalCredit,
      postedAt,
      postedBy: actor.userId,
      updatedAt: postedAt,
      updatedBy: actor.userId,
    })
    .where(eq(journalEntries.id, header.id));

  return { docNo, periodId: period.id, postedAt };
}

/* ------------------------------------------------------------------ */
/* Baca                                                                */
/* ------------------------------------------------------------------ */

export async function getJournal(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "accounting.journals.read");

  return inTx(externalTx, async (tx) => {
    const header = await requireHeader(tx, id);
    const lines = await loadLines(tx, id);
    return { ...header, lines };
  });
}

const cursorSchema = z.object({
  d: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  i: z.uuid(),
});

function encodeCursor(entryDate: string, id: string): string {
  return Buffer.from(JSON.stringify({ d: entryDate, i: id }), "utf8").toString("base64url");
}

function decodeCursor(raw: string): { entryDate: string; id: string } {
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    if (parsed.success) return { entryDate: parsed.data.d, id: parsed.data.i };
  } catch {
    // fallthrough
  }
  throw validationFailed([{ path: "cursor", message: "Cursor tidak valid." }]);
}

/**
 * Daftar jurnal (header saja) dengan keyset paginasi, terbaru dulu.
 * Filter: status, dateFrom/dateTo, accountId, branchId, departmentId.
 * Untuk filter per baris (accountId/branchId/departmentId), subquery EXISTS dipakai
 * agar tetap memakai indeks `journal_entries_status_date_idx`.
 */
export async function listJournals(
  actor: AuthContext,
  query: ListJournalsQuery = {},
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.journals.read");

  const limit = query.limit ?? DEFAULT_LIST_LIMIT;
  const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);

  const conditions: (SQL | undefined)[] = [
    query.status === undefined ? undefined : eq(journalEntries.status, query.status),
    query.dateFrom === undefined ? undefined : gte(journalEntries.entryDate, query.dateFrom),
    query.dateTo === undefined ? undefined : lte(journalEntries.entryDate, query.dateTo),
    query.accountId === undefined
      ? undefined
      : sql`exists (select 1 from journal_entry_lines l where l.entry_id = ${journalEntries.id} and l.account_id = ${query.accountId})`,
    query.branchId === undefined
      ? undefined
      : sql`exists (select 1 from journal_entry_lines l where l.entry_id = ${journalEntries.id} and l.branch_id = ${query.branchId})`,
    query.departmentId === undefined
      ? undefined
      : sql`exists (select 1 from journal_entry_lines l where l.entry_id = ${journalEntries.id} and l.department_id = ${query.departmentId})`,
    cursor === undefined
      ? undefined
      : sql`(${journalEntries.entryDate}, ${journalEntries.id}) < (${cursor.entryDate}::date, ${cursor.id}::uuid)`,
  ];

  const reader = externalTx ?? db;
  const rows = await reader
    .select(journalHeaderColumns)
    .from(journalEntries)
    .where(and(...conditions))
    .orderBy(desc(journalEntries.entryDate), desc(journalEntries.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page,
    nextCursor: hasMore && last ? encodeCursor(last.entryDate, last.id) : null,
  };
}

/* ------------------------------------------------------------------ */
/* Draf: create / update / cancel                                      */
/* ------------------------------------------------------------------ */

export async function createDraftJournal(
  actor: AuthContext,
  input: CreateJournalInput,
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.journals.create");

  return inTx(externalTx, async (tx) => {
    // Idempotensi tingkat API: kunci yang sama ditolak (bukan mengembalikan draf lama,
    // agar klien tahu request dobel perlu ditangani secara eksplisit).
    if (input.idempotencyKey) {
      const [existing] = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(eq(journalEntries.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (existing) throw conflict("idempotencyKey sudah dipakai untuk jurnal lain.");
    }

    await assertLinesReferenceable(tx, input.lines);
    const totals = computeTotals(input.lines);

    const [created] = await tx
      .insert(journalEntries)
      .values({
        entryDate: input.entryDate,
        status: "draft",
        description: input.description,
        reference: input.reference ?? null,
        totalDebit: totals.totalDebit,
        totalCredit: totals.totalCredit,
        idempotencyKey: input.idempotencyKey ?? null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: journalEntries.id });
    if (!created) throw new Error("Gagal membuat jurnal draf.");

    await insertLines(tx, created.id, input.lines);

    await audit.log(
      {
        action: "journal.create",
        entityType: "journal_entry",
        entityId: created.id,
        actorId: actor.userId,
        after: {
          entryDate: input.entryDate,
          description: input.description,
          reference: input.reference ?? null,
          lineCount: input.lines.length,
          totalDebit: totals.totalDebit,
          totalCredit: totals.totalCredit,
        },
      },
      tx,
    );

    const header = await requireHeader(tx, created.id);
    const lines = await loadLines(tx, created.id);
    return { ...header, lines };
  });
}

export interface SystemDraftInput {
  entryDate: string;
  description: string;
  reference?: string | null;
  lines: JournalLineInput[];
  sourceType: string;
  sourceId: string;
  sourceEvent: string;
  idempotencyKey?: string;
}

/**
 * Membuat draf jurnal "sistem" yang membawa penanda sumber (`source_type`/
 * `source_id`/`source_event`) — dipakai saldo awal & jurnal penutup (Tahap 4F).
 * WAJIB dipanggil di dalam transaksi milik pemanggil (tidak membuka transaksi baru).
 * Validasi baris dan total mengikuti mesin jurnal biasa; status akhir tetap `draft`
 * sehingga pemanggil dapat memposting lewat `postJournal` (model dua langkah).
 */
export async function createSystemDraft(tx: Tx, actor: AuthContext, input: SystemDraftInput) {
  if (input.idempotencyKey) {
    const [existing] = await tx
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(eq(journalEntries.idempotencyKey, input.idempotencyKey))
      .limit(1);
    if (existing) throw conflict("idempotencyKey sudah dipakai untuk jurnal lain.");
  }

  await assertLinesReferenceable(tx, input.lines);
  const totals = computeTotals(input.lines);

  const [created] = await tx
    .insert(journalEntries)
    .values({
      entryDate: input.entryDate,
      status: "draft",
      description: input.description,
      reference: input.reference ?? null,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceEvent: input.sourceEvent,
      totalDebit: totals.totalDebit,
      totalCredit: totals.totalCredit,
      idempotencyKey: input.idempotencyKey ?? null,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    })
    .returning({ id: journalEntries.id });
  if (!created) throw new Error("Gagal membuat draf jurnal sistem.");

  await insertLines(tx, created.id, input.lines);

  await audit.log(
    {
      action: "journal.create",
      entityType: "journal_entry",
      entityId: created.id,
      actorId: actor.userId,
      after: {
        entryDate: input.entryDate,
        description: input.description,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        lineCount: input.lines.length,
        totalDebit: totals.totalDebit,
        totalCredit: totals.totalCredit,
      },
    },
    tx,
  );

  const header = await requireHeader(tx, created.id);
  const lines = await loadLines(tx, created.id);
  return { ...header, lines };
}

export async function updateDraftJournal(
  actor: AuthContext,
  id: string,
  input: UpdateJournalInput,
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.journals.update");

  return inTx(externalTx, async (tx) => {
    const header = await lockHeader(tx, id);
    if (header.status !== "draft") {
      throw businessRule("Hanya jurnal berstatus draft yang dapat diubah.");
    }

    await assertLinesReferenceable(tx, input.lines);
    const totals = computeTotals(input.lines);

    const nextEntryDate = input.entryDate ?? header.entryDate;
    const nextDescription = input.description ?? header.description;
    const nextReference =
      input.reference === undefined ? header.reference : input.reference;

    // Trigger `journal_entry_lines_guard` menolak DELETE bila header non-draft.
    // Header sudah divalidasi draft di atas dan FOR UPDATE lock dipegang, jadi aman.
    await tx
      .delete(journalEntryLines)
      .where(eq(journalEntryLines.entryId, id));

    await insertLines(tx, id, input.lines);

    await tx
      .update(journalEntries)
      .set({
        entryDate: nextEntryDate,
        description: nextDescription,
        reference: nextReference,
        totalDebit: totals.totalDebit,
        totalCredit: totals.totalCredit,
        updatedAt: new Date(),
        updatedBy: actor.userId,
      })
      .where(eq(journalEntries.id, id));

    await audit.log(
      {
        action: "journal.update",
        entityType: "journal_entry",
        entityId: id,
        actorId: actor.userId,
        before: {
          entryDate: header.entryDate,
          description: header.description,
          reference: header.reference,
          totalDebit: header.totalDebit,
          totalCredit: header.totalCredit,
        },
        after: {
          entryDate: nextEntryDate,
          description: nextDescription,
          reference: nextReference,
          lineCount: input.lines.length,
          totalDebit: totals.totalDebit,
          totalCredit: totals.totalCredit,
        },
      },
      tx,
    );

    const updated = await requireHeader(tx, id);
    const lines = await loadLines(tx, id);
    return { ...updated, lines };
  });
}

export async function cancelDraftJournal(
  actor: AuthContext,
  id: string,
  input: CancelJournalInput,
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.journals.cancel");

  return inTx(externalTx, async (tx) => {
    const header = await lockHeader(tx, id);
    if (header.status !== "draft") {
      throw businessRule("Hanya jurnal berstatus draft yang dapat dibatalkan.");
    }

    const now = new Date();
    await tx
      .update(journalEntries)
      .set({
        status: "cancelled",
        reason: input.reason,
        cancelledAt: now,
        cancelledBy: actor.userId,
        updatedAt: now,
        updatedBy: actor.userId,
      })
      .where(eq(journalEntries.id, id));

    await audit.log(
      {
        action: "journal.cancel",
        entityType: "journal_entry",
        entityId: id,
        actorId: actor.userId,
        before: { status: header.status },
        after: { status: "cancelled", reason: input.reason },
      },
      tx,
    );

    const updated = await requireHeader(tx, id);
    const lines = await loadLines(tx, id);
    return { ...updated, lines };
  });
}

/* ------------------------------------------------------------------ */
/* Posting                                                             */
/* ------------------------------------------------------------------ */

export async function postJournal(actor: AuthContext, id: string, externalTx?: Tx) {
  return inTx(externalTx, async (tx) => {
    const header = await lockHeader(tx, id);
    const before = { status: header.status, docNo: header.docNo, periodId: header.periodId };

    const posted = await postInternal(tx, actor, header);

    await audit.log(
      {
        action: "journal.post",
        entityType: "journal_entry",
        entityId: id,
        actorId: actor.userId,
        before,
        after: {
          status: "posted",
          docNo: posted.docNo,
          periodId: posted.periodId,
          postedAt: posted.postedAt.toISOString(),
        },
      },
      tx,
    );

    const updated = await requireHeader(tx, id);
    const lines = await loadLines(tx, id);
    return { ...updated, lines };
  });
}

/* ------------------------------------------------------------------ */
/* Reversal                                                            */
/* ------------------------------------------------------------------ */

/**
 * Reversal: dalam SATU transaksi:
 *  1. Kunci header asli (FOR UPDATE); pastikan status `posted` dan belum ada reversal aktif.
 *  2. Sisipkan draf reversal (reversal_of_id = id asli; sisi baris ditukar;
 *     tanggal = `input.entryDate ?? entryDate asli`).
 *  3. Posting draf reversal (nomor, periode, total dihitung di `postInternal`).
 *  4. Update status asli menjadi `reversed` (hanya kolom status/updated_*;
 *     trigger menuntut reversal sudah posted dan kolom lain identik).
 *
 * Kunci idempotensi: `journal_entries_reversal_uq` partial unique pada
 * `reversal_of_id WHERE status <> 'cancelled'`. Bila reversal sebelumnya telah
 * dibuat tapi dibatalkan, reversal baru tetap diizinkan.
 */
export async function reverseJournal(
  actor: AuthContext,
  id: string,
  input: ReverseJournalInput,
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.journals.reverse");

  return inTx(externalTx, async (tx) => {
    const original = await lockHeader(tx, id);
    if (original.status !== "posted") {
      throw businessRule("Hanya jurnal berstatus posted yang dapat direversal.");
    }

    const [existingReversal] = await tx
      .select({ id: journalEntries.id, status: journalEntries.status })
      .from(journalEntries)
      .where(and(eq(journalEntries.reversalOfId, id), sql`${journalEntries.status} <> 'cancelled'`))
      .limit(1);
    if (existingReversal) {
      throw conflict("Jurnal ini sudah memiliki reversal aktif.");
    }

    const originalLines = await loadLines(tx, id);
    if (originalLines.length < 2) {
      throw businessRule("Jurnal asal tidak memiliki baris yang cukup untuk direversal.");
    }

    const reversalEntryDate = input.entryDate ?? original.entryDate;
    const now = new Date();

    const [reversalDraft] = await tx
      .insert(journalEntries)
      .values({
        entryDate: reversalEntryDate,
        status: "draft",
        description: `Reversal ${original.docNo ?? original.id}`,
        reference: original.reference,
        reversalOfId: original.id,
        reason: input.reason,
        totalDebit: "0.00",
        totalCredit: "0.00",
        createdBy: actor.userId,
        updatedBy: actor.userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: journalEntries.id });
    if (!reversalDraft) throw new Error("Gagal membuat draf reversal.");

    // Salin baris dengan sisi ditukar: debit-asal -> kredit baru; kredit-asal -> debit baru.
    // Semua dimensi (branch/department/cost center) ikut disalin — laporan berbasis
    // tag (pusat biaya/proyek) membaca posted+reversed sehingga reversal tanpa tag
    // akan membuat dimensi asal overstated permanen.
    const flippedLines: JournalLineInput[] = originalLines.map((line) => {
      const wasDebit = line.debit !== "0.00";
      return {
        accountId: line.accountId,
        side: wasDebit ? "credit" : "debit",
        amount: wasDebit ? line.debit : line.credit,
        memo: line.memo,
        branchId: line.branchId,
        departmentId: line.departmentId,
        costCenterId: line.costCenterId,
      };
    });

    await insertLines(tx, reversalDraft.id, flippedLines);

    const draftHeader = await requireHeader(tx, reversalDraft.id);
    const posted = await postInternal(tx, actor, draftHeader);

    // Balik status jurnal asal menjadi `reversed`. Trigger menuntut reversal posted
    // dan hanya kolom status/updated_at/updated_by yang boleh berubah.
    await tx
      .update(journalEntries)
      .set({
        status: "reversed",
        updatedAt: new Date(),
        updatedBy: actor.userId,
      })
      .where(eq(journalEntries.id, original.id));

    await audit.log(
      {
        action: "journal.reverse",
        entityType: "journal_entry",
        entityId: original.id,
        actorId: actor.userId,
        before: { status: original.status, docNo: original.docNo },
        after: {
          status: "reversed",
          reversalId: reversalDraft.id,
          reversalDocNo: posted.docNo,
          reason: input.reason,
        },
      },
      tx,
    );

    const updatedOriginal = await requireHeader(tx, original.id);
    const reversalHeader = await requireHeader(tx, reversalDraft.id);
    const reversalLines = await loadLines(tx, reversalDraft.id);

    return {
      original: updatedOriginal,
      reversal: { ...reversalHeader, lines: reversalLines },
    };
  });
}