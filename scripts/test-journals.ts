import { eq, sql } from "drizzle-orm";

import { accountingPeriods, chartAccounts, users } from "@/db/schema";
import {
  cancelDraftJournal,
  createDraftJournal,
  getJournal,
  listJournals,
  postJournal,
  reverseJournal,
  updateDraftJournal,
} from "@/modules/accounting/journal-service";
import type { JournalLineInput } from "@/modules/accounting/schemas";
import { loadGrants } from "@/server/authz";
import { db } from "@/server/db";

/**
 * Skrip uji sementara untuk Tahap 4D + verifikasi perilaku trigger 4B-2
 * (imutabilitas jurnal posted, keseimbangan, periode, reversal-first).
 *
 * Seluruh operasi berjalan dalam SATU `db.transaction` dengan `throw Rollback`
 * di akhir, sehingga TIDAK ADA data yang tersimpan ke database. Tidak perlu
 * persetujuan Bagian 2.2 karena tidak melakukan commit.
 *
 * Prasyarat:
 *  - Seed COA demo sudah dijalankan (`bun run db:seed-coa`)
 *  - FY2030 dengan periode P1 (2030-01) tersedia dan berstatus `open`
 *    (sudah dibuat oleh scripts/test-fiscal.ts).
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

class Rollback extends Error {}

/**
 * Savepoint eksplisit via SQL (bukan `tx.transaction`) — setelah `RAISE EXCEPTION`
 * pada trigger, drizzle nested transaction kadang membiarkan transaksi luar dalam
 * state aborted. Manual `SAVEPOINT` / `ROLLBACK TO SAVEPOINT` lebih deterministik.
 */
async function expectError(label: string, tx: Tx, fn: () => Promise<unknown>) {
  await tx.execute(sql`savepoint sp_err`);
  try {
    await fn();
    await tx.execute(sql`release savepoint sp_err`);
    console.log(label, "GAGAL: seharusnya ditolak");
  } catch (error) {
    await tx.execute(sql`rollback to savepoint sp_err`);
    const e = error as { code?: string; message?: string };
    console.log(label, e.code ?? "-", "|", e.message ?? String(error));
  }
}

async function main() {
  const [u] = await db.select({ id: users.id }).from(users).limit(1);
  if (!u) throw new Error("Belum ada pengguna.");

  const actor = {
    userId: u.id,
    name: "Uji",
    email: "uji@example.com",
    grants: await loadGrants(u.id),
  };

  // Ambil akun dari COA demo (seed `db:seed-coa`).
  const [accKas] = await db
    .select({ id: chartAccounts.id })
    .from(chartAccounts)
    .where(eq(chartAccounts.code, "1111"));
  const [accPiutang] = await db
    .select({ id: chartAccounts.id })
    .from(chartAccounts)
    .where(eq(chartAccounts.code, "1200"));
  const [accBank] = await db
    .select({ id: chartAccounts.id })
    .from(chartAccounts)
    .where(eq(chartAccounts.code, "1112"));
  const [accInduk] = await db
    .select({ id: chartAccounts.id })
    .from(chartAccounts)
    .where(eq(chartAccounts.code, "1100")); // non-postable

  if (!accKas || !accPiutang || !accBank || !accInduk) {
    throw new Error("COA demo belum lengkap. Jalankan `bun run db:seed-coa` dulu.");
  }

  // Periode untuk entryDate 2030-01-15.
  const [period] = await db
    .select({ id: accountingPeriods.id, status: accountingPeriods.status })
    .from(accountingPeriods)
    .where(eq(accountingPeriods.startDate, "2030-01-01"))
    .limit(1);
  if (!period) throw new Error("Periode FY2030-P1 belum dibuat. Jalankan scripts/test-fiscal.ts.");
  const entryDate = "2030-01-15";

  // Helper: baris seimbang debit kas = kredit piutang.
  const balancedLines: JournalLineInput[] = [
    { accountId: accKas.id, side: "debit", amount: "500000.00" },
    { accountId: accPiutang.id, side: "credit", amount: "500000.00" },
  ];

  try {
    await db.transaction(async (tx) => {
      /* ===== T1: tolak baris dengan akun non-postable ===== */
      await expectError("non-postable", tx, () =>
        createDraftJournal(
          actor,
          {
            entryDate,
            description: "T1 akun non-postable",
            lines: [
              { accountId: accInduk.id, side: "debit", amount: "1000.00" },
              { accountId: accKas.id, side: "credit", amount: "1000.00" },
            ],
          },
          tx,
        ),
      );

      /* ===== T2: buat draf seimbang -> sukses ===== */
      const j1 = await createDraftJournal(
        actor,
        {
          entryDate,
          description: "T2 draf awal",
          lines: balancedLines,
          idempotencyKey: "test-j-unique-001",
        },
        tx,
      );
      console.log("draf 1", j1.status, j1.docNo, j1.totalDebit, j1.totalCredit, "lines:", j1.lines.length);

      /* ===== T3: idempotencyKey duplikat -> 409 ===== */
      await expectError("idempotencyKey dup", tx, () =>
        createDraftJournal(
          actor,
          {
            entryDate,
            description: "T3 dup key",
            lines: balancedLines,
            idempotencyKey: "test-j-unique-001",
          },
          tx,
        ),
      );

      /* ===== T4: update draf -> sukses, totals dihitung ulang ===== */
      const j1u = await updateDraftJournal(
        actor,
        j1.id,
        {
          description: "T4 update",
          lines: [
            { accountId: accKas.id, side: "debit", amount: "1000000.00" },
            { accountId: accBank.id, side: "credit", amount: "750000.00" },
            { accountId: accPiutang.id, side: "credit", amount: "250000.00" },
          ],
        },
        tx,
      );
      console.log("update draf", j1u.lines.length, "debit", j1u.totalDebit, "kredit", j1u.totalCredit);

      /* ===== T5: posting draf TIDAK seimbang -> Business rule ===== */
      const jBad = await createDraftJournal(
        actor,
        {
          entryDate,
          description: "T5 draf tidak seimbang",
          lines: [
            { accountId: accKas.id, side: "debit", amount: "100000.00" },
            { accountId: accPiutang.id, side: "credit", amount: "99000.00" },
          ],
        },
        tx,
      );
      await expectError("post tidak seimbang", tx, () => postJournal(actor, jBad.id, tx));

      /* ===== T6: posting draf seimbang -> sukses, doc_no terisi ===== */
      const j1p = await postJournal(actor, j1.id, tx);
      console.log("post j1", j1p.status, j1p.docNo, "period", j1p.periodId === period.id, "postedAt", !!j1p.postedAt);

      /* ===== T7: imutabilitas header posted (service menolak update) ===== */
      await expectError("update posted (service)", tx, () =>
        updateDraftJournal(
          actor,
          j1.id,
          { lines: balancedLines, description: "coba ubah posted" },
          tx,
        ),
      );

      /* ===== T8: imutabilitas via raw SQL (trigger 4B-2) ===== */
      await expectError("UPDATE description via raw SQL", tx, async () => {
        // Bypass service; menguji trigger `journal_entries_guard` secara langsung.
        await tx.execute(
          sql`update journal_entries set description = 'nakal' where id = ${j1.id}`,
        );
      });
      await expectError("DELETE posted via raw SQL", tx, async () => {
        await tx.execute(sql`delete from journal_entries where id = ${j1.id}`);
      });
      await expectError("UPDATE baris posted via raw SQL", tx, async () => {
        const line = j1p.lines[0]!;
        await tx.execute(sql`update journal_entry_lines set debit = '999.00' where id = ${line.id}`);
      });

      /* ===== T9: reversal j1 -> sukses; j1 jadi reversed; reversal posted ===== */
      const rev1 = await reverseJournal(actor, j1.id, { reason: "Koreksi typo" }, tx);
      console.log(
        "reversal",
        rev1.original.status,
        rev1.reversal.status,
        rev1.reversal.docNo,
        "sisi baris:",
        rev1.reversal.lines.map((l) => (l.debit !== "0.00" ? `D${l.debit}` : `K${l.credit}`)).join(","),
      );

      /* ===== T10: reversal kedua untuk jurnal yang sama -> 409 ===== */
      await expectError("reversal duplikat", tx, () =>
        reverseJournal(actor, j1.id, { reason: "Koreksi lagi" }, tx),
      );

      /* ===== T11: posting jurnal reversed -> ditolak ===== */
      await expectError("post jurnal reversed", tx, () => postJournal(actor, j1.id, tx));

      /* ===== T12: reversal jurnal reversed -> ditolak ===== */
      await expectError("reversal jurnal reversed", tx, () =>
        reverseJournal(actor, j1.id, { reason: "Re-reverse" }, tx),
      );

      /* ===== T13: cancel draf -> sukses, lalu tidak bisa diubah/diposting ===== */
      const jC = await createDraftJournal(
        actor,
        { entryDate, description: "T13 draf untuk cancel", lines: balancedLines },
        tx,
      );
      const cancelled = await cancelDraftJournal(actor, jC.id, { reason: "Salah input" }, tx);
      console.log("cancel draf", cancelled.status, "reason:", cancelled.reason?.slice(0, 15));
      await expectError("post cancelled", tx, () => postJournal(actor, jC.id, tx));
      await expectError("update cancelled", tx, () =>
        updateDraftJournal(actor, jC.id, { lines: balancedLines }, tx),
      );

      /* ===== T14: periode closed menolak posting ===== */
      await tx.execute(sql`update accounting_periods set status = 'closed' where id = ${period.id}`);
      const jClosed = await createDraftJournal(
        actor,
        { entryDate, description: "T14 ke periode closed", lines: balancedLines },
        tx,
      );
      await expectError("post ke closed", tx, () => postJournal(actor, jClosed.id, tx));
      await tx.execute(sql`update accounting_periods set status = 'open' where id = ${period.id}`);

      /* ===== T15: soft_closed butuh izin khusus ===== */
      await tx.execute(sql`update accounting_periods set status = 'soft_closed' where id = ${period.id}`);
      const jSoft = await createDraftJournal(
        actor,
        { entryDate, description: "T15 ke periode soft_closed", lines: balancedLines },
        tx,
      );
      const withoutPerms = actor.grants.filter((g) => g.code !== "accounting.journals.post_closed_period");
      await expectError("post soft_closed tanpa izin khusus", tx, () =>
        postJournal({ ...actor, grants: withoutPerms }, jSoft.id, tx),
      );
      const softPosted = await postJournal(actor, jSoft.id, tx); // actor memiliki izin
      console.log("post soft_closed dengan izin", softPosted.status, softPosted.docNo);
      await tx.execute(sql`update accounting_periods set status = 'open' where id = ${period.id}`);

      /* ===== T16: entry_date di luar seluruh periode -> ditolak ===== */
      const jOrphan = await createDraftJournal(
        actor,
        { entryDate: "2031-12-31", description: "T16 tanggal tanpa periode", lines: balancedLines },
        tx,
      );
      await expectError("post 2031-12-31 tanpa periode", tx, () => postJournal(actor, jOrphan.id, tx));

      /* ===== T17: list + get ===== */
      const listDraft = await listJournals(actor, { status: "draft", dateFrom: "2030-01-01", dateTo: "2030-01-31", limit: 50 }, tx);
      console.log("list draft", listDraft.items.length, "next", listDraft.nextCursor);
      const detail = await getJournal(actor, jSoft.id, tx);
      console.log("detail", detail.status, detail.docNo, "lines:", detail.lines.length);

      /* ===== T18: permission gate ===== */
      await expectError("tanpa izin create", tx, () =>
        createDraftJournal(
          { ...actor, grants: [] },
          { entryDate, description: "T18", lines: balancedLines },
          tx,
        ),
      );
      await expectError("tanpa izin post", tx, () =>
        postJournal({ ...actor, grants: [] }, jOrphan.id, tx),
      );

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log("[test-journals] rollback OK — tidak ada jurnal tersimpan di DB.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[test-journals] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });