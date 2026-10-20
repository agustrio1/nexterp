/**
 * Daftar permission modul Core. Format: modul.resource.aksi.
 * Modul lain menambahkan file permissions.ts sendiri; agregasinya dibuat di Tahap 3D.
 */
export const corePermissions = [
  { code: "core.users.read", description: "Melihat daftar dan detail pengguna" },
  { code: "core.users.create", description: "Membuat pengguna" },
  { code: "core.users.update", description: "Mengubah data pengguna dan penugasan role" },
  { code: "core.users.deactivate", description: "Menonaktifkan atau mengaktifkan pengguna" },

  { code: "core.roles.read", description: "Melihat role dan permission-nya" },
  { code: "core.roles.manage", description: "Membuat, mengubah, dan menghapus role" },
  { code: "core.permissions.read", description: "Melihat daftar permission" },

  { code: "core.company.read", description: "Melihat profil perusahaan" },
  { code: "core.company.update", description: "Mengubah profil perusahaan" },
  { code: "core.settings.read", description: "Melihat pengaturan aplikasi" },
  { code: "core.settings.update", description: "Mengubah pengaturan aplikasi" },

  { code: "core.branches.read", description: "Melihat cabang" },
  { code: "core.branches.manage", description: "Mengelola cabang" },
  { code: "core.departments.read", description: "Melihat departemen" },
  { code: "core.departments.manage", description: "Mengelola departemen" },

  { code: "core.fiscal_years.read", description: "Melihat tahun fiskal" },
  { code: "core.fiscal_years.manage", description: "Mengelola tahun fiskal" },
  { code: "core.periods.read", description: "Melihat periode akuntansi" },
  { code: "core.periods.manage", description: "Mengelola periode akuntansi" },
  { code: "core.periods.close", description: "Menutup periode akuntansi" },
  { code: "core.periods.reopen", description: "Membuka kembali periode yang sudah ditutup" },

  { code: "core.currencies.read", description: "Melihat mata uang" },
  { code: "core.currencies.manage", description: "Mengelola mata uang" },
  { code: "core.exchange_rates.read", description: "Melihat kurs" },
  { code: "core.exchange_rates.manage", description: "Mengelola kurs" },

  { code: "core.audit_logs.read", description: "Melihat log audit" },

  { code: "core.approvals.read", description: "Melihat permintaan persetujuan" },
  { code: "core.approvals.request", description: "Mengajukan dokumen untuk persetujuan" },
  { code: "core.approvals.act", description: "Menyetujui atau menolak langkah persetujuan" },
  { code: "core.approvals.cancel", description: "Menarik/membatalkan pengajuan persetujuan" },
  { code: "core.approval_workflows.read", description: "Melihat alur persetujuan" },
  { code: "core.approval_workflows.manage", description: "Mengelola alur persetujuan" },

  { code: "core.attachments.read", description: "Melihat dan mengunduh lampiran" },
  { code: "core.attachments.upload", description: "Mengunggah lampiran" },
  { code: "core.attachments.delete", description: "Menghapus lampiran" },
] as const;

export type CorePermissionCode = (typeof corePermissions)[number]["code"];