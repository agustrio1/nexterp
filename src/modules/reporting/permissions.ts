/**
 * Daftar permission modul Reporting & Dashboard (Tahap 8A). Format: modul.resource.aksi.
 * Dashboard hanya agregasi read-only dari laporan modul sumber; ekspor berjalan
 * sebagai background job (job_runs) dan hasilnya diambil per job.
 */
export const reportingPermissions = [
  { code: "reporting.dashboards.read", description: "Melihat dashboard eksekutif & per modul" },
  { code: "reporting.exports.read", description: "Melihat/mengunduh hasil job ekspor" },
  { code: "reporting.exports.manage", description: "Membuat dan membatalkan job ekspor" },
] as const;

export type ReportingPermissionCode = (typeof reportingPermissions)[number]["code"];
