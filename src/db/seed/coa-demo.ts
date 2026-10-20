import { eq } from "drizzle-orm";

import { chartAccounts } from "@/db/schema";
import type { accountTypeEnum } from "@/db/schema";
import { db } from "@/server/db";

/**
 * Seed COA demo (Tahap 4C-4).
 *
 * SIFAT:
 *  - DE_MO. Hanya untuk mengisi bagan akun awal saat pengembangan/demonstrasi.
 *    Semua baris diberi awalan "[DEMO]" pada `description` agar mudah dikenali
 *    dan dapat dibedakan dari COA produksi.
 *  - IDEMPOTEN. Kombinasi `code` unique; baris yang sudah ada dilewati (tidak
 *    menimpa `name`/`isPostable` yang mungkin sudah diubah manual).
 *  - TIDAK menulis ke audit log dan TIDAK memakai actor (by design: bootstrap).
 *
 * Jalankan setelah `bun run db:seed` (butuh role super_admin + permission terisi)
 * dan hanya dengan persetujuan eksplisit sesuai Bagian 2.2:
 *   bun run src/db/seed/coa-demo.ts
 *
 * Struktur: 5 kelas akar (1..5) -> kelompok non-postable -> leaf postable.
 * Aturan pohon yang dijaga service (tipe anak = tipe induk; induk dengan anak
 * harus non-postable) dipenuhi di sini.
 */

type SeedAccount = {
  code: string;
  name: string;
  /** Sama dengan `accountTypeEnum` di skema. */
  type: (typeof accountTypeEnum.enumValues)[number];
  parentCode: string | null;
  isPostable: boolean;
  description: string;
};

const DEMO_PREFIX = "[DEMO]";

const seedAccounts: SeedAccount[] = [
  // ------------------------------------------------------------- Kelas 1: Aset
  { code: "1000", name: "Aset", type: "asset", parentCode: null, isPostable: false, description: "Kelas akun aset." },
  { code: "1100", name: "Aset Lancar", type: "asset", parentCode: "1000", isPostable: false, description: "Aset yang dapat dicairkan dalam 1 tahun." },
  { code: "1110", name: "Kas dan Bank", type: "asset", parentCode: "1100", isPostable: false, description: "Tempat penyimpanan uang tunai dan saldo bank." },
  { code: "1111", name: "Kas Kecil", type: "asset", parentCode: "1110", isPostable: true, description: "Kas Operasional di kantor pusat." },
  { code: "1112", name: "Bank - Checking IDR", type: "asset", parentCode: "1110", isPostable: true, description: "Rekening giro dalam mata uang dasar." },
  { code: "1200", name: "Piutang Usaha", type: "asset", parentCode: "1100", isPostable: true, description: "Tagihan ke pelanggan atas penjualan kredit." },
  { code: "1300", name: "Persediaan Barang Dagangan", type: "asset", parentCode: "1100", isPostable: true, description: "Nilai persediaan siap jual (FIFO)." },
  { code: "1400", name: "Beban Dibayar di Muka", type: "asset", parentCode: "1100", isPostable: true, description: "Beban dibayar diterima (sewa, asuransi)." },
  { code: "1500", name: "Aset Tidak Lancar", type: "asset", parentCode: "1000", isPostable: false, description: "Aset tetap dan penyusutannya." },
  { code: "1510", name: "Tanah", type: "asset", parentCode: "1500", isPostable: true, description: "Nilai perolehan tanah." },
  { code: "1520", name: "Bangunan", type: "asset", parentCode: "1500", isPostable: true, description: "Nilai perolehan bangunan." },
  { code: "1525", name: "Akumulasi Penyusutan Bangunan", type: "asset", parentCode: "1500", isPostable: true, description: "Kontra aset: akumulasi penyusutan bangunan." },
  { code: "1530", name: "Kendaraan", type: "asset", parentCode: "1500", isPostable: true, description: "Nilai perolehan kendaraan." },
  { code: "1535", name: "Akumulasi Penyusutan Kendaraan", type: "asset", parentCode: "1500", isPostable: true, description: "Kontra aset: akumulasi penyusutan kendaraan." },
  { code: "1540", name: "Peralatan", type: "asset", parentCode: "1500", isPostable: true, description: "Nilai perolehan peralatan kantor/fabrikasi." },
  { code: "1545", name: "Akumulasi Penyusutan Peralatan", type: "asset", parentCode: "1500", isPostable: true, description: "Kontra aset: akumulasi penyusutan peralatan." },

  // ------------------------------------------------------ Kelas 2: Liabilitas
  { code: "2000", name: "Liabilitas", type: "liability", parentCode: null, isPostable: false, description: "Kelas akun kewajiban." },
  { code: "2100", name: "Liabilitas Jangka Pendek", type: "liability", parentCode: "2000", isPostable: false, description: "Kewajiban jatuh tempo <= 1 tahun." },
  { code: "2110", name: "Utang Usaha", type: "liability", parentCode: "2100", isPostable: true, description: "Kewajiban ke pemasok atas pembelian kredit." },
  { code: "2115", name: "GR/IR - Penerimaan Belum Ditagih", type: "liability", parentCode: "2100", isPostable: true, description: "Akun perantara goods-received-not-invoiced (persediaan masuk, tagihan belum)." },
  { code: "2120", name: "Utang Gaji", type: "liability", parentCode: "2100", isPostable: true, description: "Gaji terutang belum dibayar." },
  { code: "2130", name: "Utang Pajak", type: "liability", parentCode: "2100", isPostable: true, description: "Pajak terutang belum disetor." },
  { code: "2200", name: "Liabilitas Jangka Panjang", type: "liability", parentCode: "2000", isPostable: false, description: "Kewajiban jatuh tempo > 1 tahun." },
  { code: "2210", name: "Utang Bank Jangka Panjang", type: "liability", parentCode: "2200", isPostable: true, description: "Fasilitas bank berjangka." },

  // ------------------------------------------------------------ Kelas 3: Ekuitas
  { code: "3000", name: "Ekuitas", type: "equity", parentCode: null, isPostable: false, description: "Kelas akun modal." },
  { code: "3100", name: "Modal Disetor", type: "equity", parentCode: "3000", isPostable: false, description: "Setoran pemegang saham." },
  { code: "3110", name: "Modal Pemegang Saham", type: "equity", parentCode: "3100", isPostable: true, description: "Nilai nominal saham ditempatkan." },
  { code: "3200", name: "Laba Ditahan", type: "equity", parentCode: "3000", isPostable: true, description: "Akumulasi laba tahun-tahun sebelumnya." },

  // -------------------------------------------------------- Kelas 4: Pendapatan
  { code: "4000", name: "Pendapatan", type: "revenue", parentCode: null, isPostable: false, description: "Kelas akun pendapatan." },
  { code: "4100", name: "Pendapatan Penjualan", type: "revenue", parentCode: "4000", isPostable: true, description: "Pendapatan dari penjualan barang/jasa utama." },
  { code: "4200", name: "Pendapatan Lain-lain", type: "revenue", parentCode: "4000", isPostable: true, description: "Pendapatan di luar operasi utama." },

  // ------------------------------------------------------------- Kelas 5: Beban
  { code: "5000", name: "Beban", type: "expense", parentCode: null, isPostable: false, description: "Kelas akun beban." },
  { code: "5100", name: "Harga Pokok Penjualan", type: "expense", parentCode: "5000", isPostable: true, description: "HPP berdasarkan konsumsi FIFO." },
  { code: "5200", name: "Beban Operasional", type: "expense", parentCode: "5000", isPostable: false, description: "Beban rutin operasional." },
  { code: "5210", name: "Beban Gaji dan Tunjangan", type: "expense", parentCode: "5200", isPostable: true, description: "Gaji, tunjangan, dan iuran karyawan." },
  { code: "5220", name: "Beban Sewa", type: "expense", parentCode: "5200", isPostable: true, description: "Sewa kantor/gudang/mesin." },
  { code: "5230", name: "Beban Penyusutan Aset Tetap", type: "expense", parentCode: "5200", isPostable: true, description: "Beban penyusutan periodik." },
  { code: "5240", name: "Beban Utilitas", type: "expense", parentCode: "5200", isPostable: true, description: "Listrik, air, telepon, internet." },
  { code: "5300", name: "Beban Lain-lain", type: "expense", parentCode: "5000", isPostable: true, description: "Beban di luar operasional rutin." },
];

function descriptionFor(raw: string): string {
  return `${DEMO_PREFIX} ${raw}`;
}

async function main() {
  // Peta code -> id untuk akun yang sudah ada maupun baru, agar relasi induk bisa
  // diselesaikan tanpa membaca ulang per iterasi.
  const idByCode = new Map<string, string>();

  const inserted = { created: 0, skipped: 0 };

  await db.transaction(async (tx) => {
    for (const account of seedAccounts) {
      const [existing] = await tx
        .select({ id: chartAccounts.id })
        .from(chartAccounts)
        .where(eq(chartAccounts.code, account.code))
        .limit(1);

      if (existing) {
        idByCode.set(account.code, existing.id);
        inserted.skipped += 1;
        continue;
      }

      const parentId =
        account.parentCode !== null ? (idByCode.get(account.parentCode) ?? null) : null;
      if (account.parentCode !== null && parentId === null) {
        throw new Error(
          `Induk ${account.parentCode} untuk akun ${account.code} belum ada; urutan seed salah.`,
        );
      }

      const [created] = await tx
        .insert(chartAccounts)
        .values({
          code: account.code,
          name: account.name,
          type: account.type,
          parentId,
          isPostable: account.isPostable,
          isActive: true,
          description: descriptionFor(account.description),
        })
        .returning({ id: chartAccounts.id });

      if (!created) throw new Error(`Gagal membuat akun ${account.code}.`);
      idByCode.set(account.code, created.id);
      inserted.created += 1;
    }
  });

  console.log(
    `[coa-demo] Selesai. Akun dibuat: ${inserted.created}, dilewati (sudah ada): ${inserted.skipped}, total entri: ${seedAccounts.length}.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[coa-demo] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });