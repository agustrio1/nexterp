import { eq } from "drizzle-orm";

import { branches } from "@/db/schema";
import { db } from "@/server/db";
import { nextDocumentNumber } from "@/server/numbering";

/**
 * Skrip uji sementara untuk 3I-1. Memakai tahun uji 2090-an agar terpisah dari data nyata.
 * Boleh dihapus setelah semua hasil sesuai.
 */

class Rollback extends Error {}

async function expectError(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    console.log(label, "GAGAL: seharusnya ditolak");
  } catch (error) {
    console.log(label, "|", error instanceof Error ? error.message : error);
  }
}

async function branchId(code: string): Promise<string> {
  const [row] = await db.select({ id: branches.id }).from(branches).where(eq(branches.code, code));
  if (!row) throw new Error(`Cabang ${code} belum ada.`);
  return row.id;
}

async function main() {
  // 1. Rollback: nomor yang diambil di transaksi yang dibatalkan tidak boleh hilang dari urutan.
  const first: string[] = [];
  try {
    await db.transaction(async (tx) => {
      for (let i = 0; i < 3; i++) {
        first.push(await nextDocumentNumber(tx, "journal_entry", { date: "2099-01-15" }));
      }
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  console.log("dalam transaksi", first.join(","));

  const a = await db.transaction((tx) =>
    nextDocumentNumber(tx, "journal_entry", { date: "2099-01-15" }),
  );
  const b = await db.transaction((tx) =>
    nextDocumentNumber(tx, "journal_entry", { date: "2099-06-30" }),
  );
  console.log("setelah rollback", a, b);

  // 2. Konkurensi: 20 transaksi paralel harus menghasilkan 20 nomor unik tanpa celah.
  const results = await Promise.all(
    Array.from({ length: 20 }, () =>
      db.transaction((tx) => nextDocumentNumber(tx, "journal_entry", { date: "2098-03-01" })),
    ),
  );
  const sorted = [...results].sort();
  console.log("paralel", new Set(results).size, sorted[0], sorted[sorted.length - 1]);

  // 3. Ganti tahun: urutan dimulai lagi dari 1.
  const dec = await db.transaction((tx) =>
    nextDocumentNumber(tx, "journal_entry", { date: "2095-12-31" }),
  );
  const jan = await db.transaction((tx) =>
    nextDocumentNumber(tx, "journal_entry", { date: "2096-01-01" }),
  );
  console.log("ganti tahun", dec, jan);

  // 4. Per cabang dan per bulan.
  const jkt = await branchId("JKT-01");
  const sby = await branchId("SBY-01");
  const next = (id: string, date: string) =>
    db.transaction((tx) => nextDocumentNumber(tx, "customer_invoice", { date, branchId: id }));

  const i1 = await next(jkt, "2094-05-10");
  const i2 = await next(sby, "2094-05-10");
  const i3 = await next(jkt, "2094-05-20");
  const i4 = await next(jkt, "2094-06-01");
  console.log("per cabang", i1, i2, i3, i4);

  // 5. Kesalahan input.
  await expectError("tanggal tak valid", () =>
    db.transaction((tx) => nextDocumentNumber(tx, "journal_entry", { date: "2099-02-30" })),
  );
  await expectError("tanpa cabang", () =>
    db.transaction((tx) => nextDocumentNumber(tx, "customer_invoice", { date: "2094-05-10" })),
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[test-numbering] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });