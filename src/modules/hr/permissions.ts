/**
 * Daftar permission modul HR (Tahap 7A). Format: modul.resource.aksi.
 * Mencakup jabatan, karyawan, kontrak, dokumen, shift, absensi, cuti, lembur,
 * evaluasi, pelatihan, plus self-service (data personal milik sendiri) & laporan.
 * Data personal dipisah dari remunerasi (`payroll.*`) sesuai keputusan 7A.
 */
export const hrPermissions = [
  { code: "hr.positions.read", description: "Melihat jabatan" },
  { code: "hr.positions.manage", description: "Membuat/mengubah/menonaktifkan jabatan" },
  { code: "hr.employees.read", description: "Melihat data master karyawan" },
  { code: "hr.employees.manage", description: "Membuat/mengubah/menonaktifkan karyawan" },
  { code: "hr.contracts.read", description: "Melihat kontrak kerja" },
  { code: "hr.contracts.manage", description: "Membuat/mengubah kontrak kerja" },
  { code: "hr.documents.read", description: "Melihat dokumen karyawan (metadata)" },
  { code: "hr.documents.manage", description: "Mencatat/mengubah dokumen karyawan" },
  { code: "hr.shifts.read", description: "Melihat shift kerja" },
  { code: "hr.shifts.manage", description: "Membuat/mengubah/menonaktifkan shift" },
  { code: "hr.attendance.read", description: "Melihat catatan absensi" },
  { code: "hr.attendance.manage", description: "Mencatat/mengubah absensi & lembur" },
  { code: "hr.leaves.read", description: "Melihat jenis, saldo, dan pengajuan cuti" },
  { code: "hr.leaves.manage", description: "Mengelola cuti & menyetujui pengajuan" },
  { code: "hr.overtime.read", description: "Melihat pengajuan lembur" },
  { code: "hr.overtime.manage", description: "Mengelola lembur & menyetujui pengajuan" },
  { code: "hr.evaluations.read", description: "Melihat evaluasi kinerja" },
  { code: "hr.evaluations.manage", description: "Membuat/mengubah evaluasi kinerja" },
  { code: "hr.training.read", description: "Melihat program & pendaftaran pelatihan" },
  { code: "hr.training.manage", description: "Mengelola program & pendaftaran pelatihan" },
  { code: "hr.self.view", description: "Melihat data personal/absensi/cuti/lembur milik sendiri" },
  { code: "hr.reports.read", description: "Melihat laporan HR (headcount, absensi, saldo cuti)" },
] as const;

export type HrPermissionCode = (typeof hrPermissions)[number]["code"];
