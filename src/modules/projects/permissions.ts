/**
 * Daftar permission modul Projects (Tahap 8A). Format: modul.resource.aksi.
 * Proyek dipetakan ke satu pusat biaya (cost center, Tahap 4G); biaya/profitabilitas
 * diturunkan dari baris jurnal ber-tag cost center, bukan tabel terpisah.
 */
export const projectsPermissions = [
  { code: "projects.master.read", description: "Melihat master proyek" },
  { code: "projects.master.manage", description: "Membuat/mengubah/menonaktifkan proyek & menaut cost center" },
  { code: "projects.tasks.read", description: "Melihat tugas & milestone proyek" },
  { code: "projects.tasks.manage", description: "Membuat/mengubah tugas & milestone proyek" },
  { code: "projects.budgets.manage", description: "Mengelola anggaran proyek" },
  { code: "projects.expenses.manage", description: "Mengelola pencatatan biaya proyek" },
  { code: "projects.assignments.manage", description: "Mengelola penugasan sumber daya proyek" },
  { code: "projects.progress.manage", description: "Memperbarui progres proyek" },
  { code: "projects.reports.read", description: "Melihat laporan profitabilitas & realisasi proyek" },
] as const;

export type ProjectsPermissionCode = (typeof projectsPermissions)[number]["code"];
