import { eq } from "drizzle-orm";

import { costCenters } from "@/db/schema";
import { db } from "@/server/db";

/**
 * Seed pusat biaya demo (Tahap 4G).
 *
 * SIFAT:
 *  - DE_MO. Hanya untuk mengisi hierarki cost center awal saat
 *    pengembangan/demonstrasi. Semua baris diberi awalan "[DEMO]" pada
 *    `description` agar mudah dikenali dan dibedakan dari data produksi.
 *  - IDEMPOTEN. Kombinasi `code` unique; baris yang sudah ada dilewati (tidak
 *    menimpa `name`/`isActive` yang mungkin sudah diubah manual).
 *  - TIDAK menulis ke audit log dan TIDAK memakai actor (by design: bootstrap).
 *  - `branchId` dibiarkan NULL = cost center berlaku lintas perusahaan.
 *
 * Jalankan setelah `bun run db:seed` dan hanya dengan persetujuan eksplisit
 * sesuai Bagian 2.2:
 *   bun run src/db/seed/cost-centers-demo.ts
 *
 * Struktur: beberapa akar -> anak. Aturan pohon (tidak ada siklus, induk
 * berbeda dari diri sendiri) dipenuhi karena seed mengurutkan induk sebelum anak.
 */

type SeedCostCenter = {
  code: string;
  name: string;
  parentCode: string | null;
  description: string;
};

const DEMO_PREFIX = "[DEMO]";

const seedCostCenters: SeedCostCenter[] = [
  // Pusat produksi
  { code: "CC-PROD", name: "Pusat Produksi", parentCode: null, description: "Seluruh aktivitas manufaktur." },
  { code: "CC-PROD-ASSY", name: "Line Perakitan", parentCode: "CC-PROD", description: "Perakitan produk jadi." },
  { code: "CC-PROD-QC", name: "Quality Control", parentCode: "CC-PROD", description: "Pengendalian mutu produksi." },

  // Pusat administrasi
  { code: "CC-ADMIN", name: "Pusat Administrasi", parentCode: null, description: "Fungsi pendukung perusahaan." },
  { code: "CC-ADMIN-HR", name: "SDM & Umum", parentCode: "CC-ADMIN", description: "Rekrutmen, payroll, dan umum." },
  { code: "CC-ADMIN-FIN", name: "Keuangan", parentCode: "CC-ADMIN", description: "Akuntansi, kas, dan pelaporan." },

  // Pusat penjualan
  { code: "CC-SALES", name: "Pusat Penjualan", parentCode: null, description: "Pemasaran dan penjualan." },
  { code: "CC-SALES-MKT", name: "Pemasaran", parentCode: "CC-SALES", description: "Promosi dan akuisisi pelanggan." },
];

function descriptionFor(raw: string): string {
  return `${DEMO_PREFIX} ${raw}`;
}

async function main() {
  // Peta code -> id untuk node yang sudah ada maupun baru, agar relasi induk
  // diselesaikan tanpa membaca ulang per iterasi.
  const idByCode = new Map<string, string>();

  const inserted = { created: 0, skipped: 0 };

  await db.transaction(async (tx) => {
    for (const center of seedCostCenters) {
      const [existing] = await tx
        .select({ id: costCenters.id })
        .from(costCenters)
        .where(eq(costCenters.code, center.code))
        .limit(1);

      if (existing) {
        idByCode.set(center.code, existing.id);
        inserted.skipped += 1;
        continue;
      }

      const parentId =
        center.parentCode !== null ? (idByCode.get(center.parentCode) ?? null) : null;
      if (center.parentCode !== null && parentId === null) {
        throw new Error(
          `Induk ${center.parentCode} untuk cost center ${center.code} belum ada; urutan seed salah.`,
        );
      }

      const [created] = await tx
        .insert(costCenters)
        .values({
          code: center.code,
          name: center.name,
          parentId,
          branchId: null,
          isActive: true,
          description: descriptionFor(center.description),
        })
        .returning({ id: costCenters.id });

      if (!created) throw new Error(`Gagal membuat cost center ${center.code}.`);
      idByCode.set(center.code, created.id);
      inserted.created += 1;
    }
  });

  console.log(
    `[cost-centers-demo] Selesai. Cost center dibuat: ${inserted.created}, dilewati (sudah ada): ${inserted.skipped}, total entri: ${seedCostCenters.length}.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[cost-centers-demo] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
