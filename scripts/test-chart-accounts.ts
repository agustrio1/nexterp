import { eq, sql } from "drizzle-orm";

import { chartAccounts, journalEntries, journalEntryLines, users } from "@/db/schema";
import {
  createChartAccount,
  getChartAccount,
  listChartAccounts,
  updateChartAccount,
} from "@/modules/accounting/chart-account-service";
import { loadGrants } from "@/server/authz";
import { db } from "@/server/db";

/**
 * Skrip uji sementara untuk 4C (bagan akun) + guard tipe DB (trigger 4B-2).
 *
 * Semua operasi dibungkus SATU `db.transaction` dan diakhiri `throw Rollback`
 * sehingga TIDAK ADA data tersimpan. Tidak menulis permanen, tidak perlu
 * persetujuan Bagian 2.2.
 */

class Rollback extends Error {}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Savepoint eksplisit via SQL. `tx.transaction((sp) => ...)` milik drizzle tidak
 * selalu mengembalikan transaksi luar setelah `RAISE EXCEPTION` pada trigger,
 * jadi kita pakai `SAVEPOINT` / `ROLLBACK TO SAVEPOINT` manual. Nama savepoint
 * boleh digunakan ulang setelah RELEASE atau ROLLBACK TO.
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
  const fake = "00000000-0000-4000-8000-000000000000";

  try {
    await db.transaction(async (tx) => {
      /* -------- Setup: akar + leaf + kelompok + grandchild -------- */
      const root = await createChartAccount(
        actor,
        { code: "T-100", name: "TEST Aset", type: "asset", parentId: null, isPostable: false, description: "akar uji" },
        tx,
      );
      const child = await createChartAccount(
        actor,
        { code: "T-100.2", name: "Kelompok piutang", type: "asset", parentId: root.id, isPostable: false },
        tx,
      );
      const grandchild = await createChartAccount(
        actor,
        { code: "T-100.2.1", name: "Piutang A", type: "asset", parentId: child.id, isPostable: true },
        tx,
      );
      const leaf = await createChartAccount(
        actor,
        { code: "T-100.1", name: "Kas uji", type: "asset", parentId: root.id, isPostable: true },
        tx,
      );
      console.log("setup", root.code, child.code, grandchild.code, leaf.code);

      /* -------- R1 tipe anak = tipe induk -------- */
      await expectError("tipe beda induk-anak", tx, () =>
        createChartAccount(
          actor,
          { code: "T-100.9", name: "Beban di bawah Aset", type: "expense", parentId: root.id, isPostable: true },
          tx,
        ),
      );

      /* -------- R2 induk postable tidak boleh punya anak -------- */
      await expectError("anak dari induk postable", tx, () =>
        createChartAccount(
          actor,
          { code: "T-100.1.1", name: "Anak dari postable", type: "asset", parentId: leaf.id, isPostable: true },
          tx,
        ),
      );

      /* -------- R2b akun yang punya anak tidak bisa dijadikan postable -------- */
      await expectError("induk ber-anak dijadikan postable", tx, () =>
        updateChartAccount(actor, child.id, { isPostable: true }, tx),
      );

      /* -------- R5 cegah siklus -------- */
      await expectError("induk = dirinya sendiri", tx, () =>
        updateChartAccount(actor, child.id, { parentId: child.id }, tx),
      );
      await expectError("siklus T-100.2 -> T-100.2.1", tx, () =>
        updateChartAccount(actor, child.id, { parentId: grandchild.id }, tx),
      );

      /* -------- R3 akun terpakai jurnal -> tolak non-postable & pindah induk -------- */
      const draft = await tx
        .insert(journalEntries)
        .values({
          entryDate: "2030-01-15",
          status: "draft",
          description: "test guard bagan akun",
          totalDebit: "1000.00",
          totalCredit: "1000.00",
          createdBy: actor.userId,
          updatedBy: actor.userId,
        })
        .returning({ id: journalEntries.id });
      const draftId = draft[0]!.id;

      await tx.insert(journalEntryLines).values([
        { entryId: draftId, lineNo: 1, accountId: leaf.id, debit: "1000.00", credit: "0.00", createdAt: new Date() },
        { entryId: draftId, lineNo: 2, accountId: grandchild.id, debit: "0.00", credit: "1000.00", createdAt: new Date() },
      ]);

      await expectError("leaf terpakai jurnal -> non-postable", tx, () =>
        updateChartAccount(actor, leaf.id, { isPostable: false }, tx),
      );
      await expectError("leaf terpakai jurnal -> pindah induk", tx, () =>
        updateChartAccount(actor, leaf.id, { parentId: child.id }, tx),
      );

      /* -------- Guard tipe DB (trigger 4B-2 bagian chart_accounts) -------- */
      await expectError("ubah tipe leaf terpakai", tx, async () => {
        await tx
          .update(chartAccounts)
          .set({ type: "expense", updatedAt: new Date() })
          .where(eq(chartAccounts.id, leaf.id));
      });

      /* -------- R4 menonaktifkan induk dengan anak aktif -------- */
      await expectError("nonaktif induk ber-anak aktif", tx, () =>
        updateChartAccount(actor, child.id, { isActive: false }, tx),
      );
      await updateChartAccount(actor, grandchild.id, { isActive: false }, tx);
      const childAfter = await updateChartAccount(actor, child.id, { isActive: false }, tx);
      console.log("nonaktif induk setelah anak", childAfter.isActive);

      /* -------- Aktifkan anak dengan induk nonaktif -> tolak -------- */
      await expectError("aktif anak saat induk nonaktif", tx, () =>
        updateChartAccount(actor, grandchild.id, { isActive: true }, tx),
      );

      /* -------- R6 code duplikat -> 409 -------- */
      await expectError("duplikat code", tx, () =>
        createChartAccount(
          actor,
          { code: "T-100.1", name: "Dup", type: "asset", parentId: root.id, isPostable: true },
          tx,
        ),
      );

      /* -------- R8 tanpa perubahan nyata -> tanpa update -------- */
      const same = await updateChartAccount(actor, leaf.id, { name: leaf.name }, tx);
      console.log("ubah tanpa perubahan", same.name);

      /* -------- Permission & NotFound -------- */
      await expectError("izin kosong", tx, () => listChartAccounts({ ...actor, grants: [] }, {}, tx));
      await expectError("id bukan UUID", tx, () => updateChartAccount(actor, fake, { name: "X" }, tx));

      /* -------- List filter -------- */
      const all = await listChartAccounts(actor, { type: "asset" }, tx);
      const leaves = await listChartAccounts(actor, { isPostable: true, type: "asset" }, tx);
      const active = await listChartAccounts(actor, { isActive: true }, tx);
      console.log("daftar asset", all.length, "postable", leaves.length, "aktif", active.length);

      /* -------- GET single -------- */
      const one = await getChartAccount(actor, root.id, tx);
      console.log("get root", one.code, one.isPostable, "children-visible", one.id === root.id);

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log("[test-chart-accounts] rollback OK — tidak ada data tersimpan.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[test-chart-accounts] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });