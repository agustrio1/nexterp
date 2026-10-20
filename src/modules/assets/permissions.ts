/**
 * Daftar permission modul Fixed Assets (Tahap 8A). Format: modul.resource.aksi.
 * Mencakup kategori, register aset, akuisisi, penyusutan (run + posting),
 * pelepasan, revaluasi, dan laporan. Jurnal aset memakai mesin akuntansi inti.
 */
export const assetsPermissions = [
  { code: "assets.categories.read", description: "Melihat kategori aset (metode & umur penyusutan)" },
  { code: "assets.categories.manage", description: "Membuat/mengubah/menonaktifkan kategori aset" },
  { code: "assets.register.read", description: "Melihat register aset tetap" },
  { code: "assets.register.manage", description: "Membuat/mengubah/menonaktifkan aset tetap" },
  { code: "assets.acquisitions.read", description: "Melihat akuisisi aset" },
  { code: "assets.acquisitions.manage", description: "Membuat/mengubah/membatalkan akuisisi (draf)" },
  { code: "assets.acquisitions.post", description: "Memosting dan mereversal jurnal akuisisi aset" },
  { code: "assets.depreciation.read", description: "Melihat jadwal & run penyusutan" },
  { code: "assets.depreciation.manage", description: "Membuat run dan menghitung penyusutan (draf)" },
  { code: "assets.depreciation.post", description: "Menyetujui, memosting, dan mereversal run penyusutan" },
  { code: "assets.disposal.read", description: "Melihat pelepasan/penjualan aset" },
  { code: "assets.disposal.manage", description: "Membuat/mengubah pelepasan (draf)" },
  { code: "assets.disposal.post", description: "Memosting dan mereversal jurnal pelepasan aset" },
  { code: "assets.revaluation.manage", description: "Membuat dan memosting revaluasi aset" },
  { code: "assets.reports.read", description: "Melihat laporan aset & rekonsiliasi penyusutan-ke-GL" },
] as const;

export type AssetsPermissionCode = (typeof assetsPermissions)[number]["code"];
