/**
 * Daftar permission modul Payroll (Tahap 7A). Format: modul.resource.aksi.
 * Mencakup struktur & komponen gaji, aturan statutory (konfiguratif), periode,
 * run (calculate/approve/post), penyesuaian, slip gaji, self-service slip, laporan.
 * Data remunerasi dipisah dari personalia (`hr.*`) sesuai keputusan 7A.
 */
export const payrollPermissions = [
  { code: "payroll.structures.read", description: "Melihat struktur gaji" },
  { code: "payroll.structures.manage", description: "Membuat/mengubah struktur gaji & kompensasi karyawan" },
  { code: "payroll.components.read", description: "Melihat komponen gaji" },
  { code: "payroll.components.manage", description: "Membuat/mengubah komponen gaji" },
  { code: "payroll.statutory.read", description: "Melihat aturan statutory (PPh 21, BPJS, dsb.)" },
  { code: "payroll.statutory.manage", description: "Mengelola aturan statutory & tarif efektif-tanggal" },
  { code: "payroll.periods.read", description: "Melihat periode payroll" },
  { code: "payroll.periods.manage", description: "Membuat/men-finalisasi/menutup periode payroll" },
  { code: "payroll.runs.read", description: "Melihat run payroll" },
  { code: "payroll.runs.manage", description: "Membuat run, menghitung, dan membatalkan (draf)" },
  { code: "payroll.runs.post", description: "Mengajukan, menyetujui, memosting, dan mereversal run payroll" },
  { code: "payroll.adjustments.read", description: "Melihat penyesuaian gaji" },
  { code: "payroll.adjustments.manage", description: "Membuat/mengubah penyesuaian gaji" },
  { code: "payroll.payslips.read", description: "Melihat slip gaji (semua karyawan)" },
  { code: "payroll.self.payslip", description: "Melihat slip gaji milik sendiri" },
  { code: "payroll.reports.read", description: "Melihat laporan payroll & rekonsiliasi GL" },
] as const;

export type PayrollPermissionCode = (typeof payrollPermissions)[number]["code"];
