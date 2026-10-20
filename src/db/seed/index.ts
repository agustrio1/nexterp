import { sql } from "drizzle-orm";

import {
  aiSettings,
  companySettings,
  currencies,
  permissions,
  rolePermissions,
  roles,
} from "@/db/schema";
import { AI_SETTINGS_ID } from "@/modules/ai/_refs";
import { allPermissions } from "@/modules/permissions";
import { db } from "@/server/db";

/**
 * Seed awal yang idempotent (aman dijalankan berulang):
 * - mata uang dan pengaturan awal: tidak menimpa data yang sudah ada
 * - permission: seluruh modul dari registri src/modules/permissions.ts; deskripsi diperbarui bila berubah
 * - role super_admin: otomatis mendapat SEMUA permission yang terdaftar
 */

// decimals = presisi pembulatan. IDR memakai 2 agar perhitungan pajak/kurs tidak kehilangan presisi.
const seedCurrencies = [
  { code: "IDR", name: "Rupiah Indonesia", symbol: "Rp", decimals: 2 },
  { code: "USD", name: "Dolar Amerika Serikat", symbol: "$", decimals: 2 },
  { code: "EUR", name: "Euro", symbol: "€", decimals: 2 },
  { code: "SGD", name: "Dolar Singapura", symbol: "S$", decimals: 2 },
];

const seedSettings = [
  { key: "base_currency", value: "IDR", description: "Mata uang dasar pembukuan" },
  { key: "timezone", value: "Asia/Jakarta", description: "Zona waktu tampilan dan batas hari transaksi" },
  { key: "costing_method", value: "FIFO", description: "Metode valuasi persediaan" },
  { key: "allow_negative_stock", value: false, description: "Izinkan stok negatif" },
];

function moduleOf(code: string): string {
  return code.slice(0, code.indexOf("."));
}

async function main() {
  // Kode ganda pada registri akan membuat INSERT ... ON CONFLICT gagal dengan pesan yang membingungkan.
  const codes = allPermissions.map((p) => p.code);
  const duplicates = codes.filter((code, index) => codes.indexOf(code) !== index);
  if (duplicates.length > 0) {
    throw new Error(`Kode permission ganda: ${[...new Set(duplicates)].join(", ")}`);
  }

  await db.transaction(async (tx) => {
    await tx.insert(currencies).values(seedCurrencies).onConflictDoNothing();
    await tx.insert(companySettings).values(seedSettings).onConflictDoNothing();

    // Baris konfigurasi AI tunggal: mati secara aman (provider none, enabled false)
    // sampai operator mengaktifkannya; ERP inti tidak pernah terganggu oleh AI.
    await tx
      .insert(aiSettings)
      .values({ id: AI_SETTINGS_ID, provider: "none", enabled: false })
      .onConflictDoNothing({ target: aiSettings.id });

    await tx
      .insert(permissions)
      .values(
        allPermissions.map((p) => ({
          code: p.code,
          module: moduleOf(p.code),
          description: p.description,
        })),
      )
      .onConflictDoUpdate({
        target: permissions.code,
        set: { description: sql`excluded.description` },
      });

    const [superAdmin] = await tx
      .insert(roles)
      .values({
        code: "super_admin",
        name: "Super Admin",
        description: "Akses penuh ke seluruh fitur sistem",
        isSystem: true,
      })
      .onConflictDoUpdate({
        target: roles.code,
        set: { name: sql`excluded.name`, description: sql`excluded.description` },
      })
      .returning({ id: roles.id });

    if (!superAdmin) {
      throw new Error("Gagal membuat role super_admin");
    }

    // Nama berbeda dari registri (allPermissions) agar tidak saling menimpa di dalam blok ini.
    const storedPermissions = await tx.select({ id: permissions.id }).from(permissions);

    await tx
      .insert(rolePermissions)
      .values(storedPermissions.map((p) => ({ roleId: superAdmin.id, permissionId: p.id })))
      .onConflictDoNothing();
  });

  console.log(`[seed] Selesai. Permission terdaftar: ${allPermissions.length}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[seed] Gagal:", error);
    process.exit(1);
  });