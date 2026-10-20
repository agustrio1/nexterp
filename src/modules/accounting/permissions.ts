/**
 * Daftar permission modul Accounting. Format: modul.resource.aksi.
 * Didaftarkan ke registri lintas modul di src/modules/permissions.ts.
 */
export const accountingPermissions = [
  { code: "accounting.accounts.read", description: "Melihat bagan akun" },
  { code: "accounting.accounts.manage", description: "Membuat, mengubah, dan menonaktifkan akun" },

  { code: "accounting.journals.read", description: "Melihat jurnal" },
  { code: "accounting.journals.create", description: "Membuat jurnal draf" },
  { code: "accounting.journals.update", description: "Mengubah jurnal draf" },
  { code: "accounting.journals.cancel", description: "Membatalkan jurnal draf" },
  { code: "accounting.journals.post", description: "Memposting jurnal" },
  {
    code: "accounting.journals.post_closed_period",
    description: "Memposting jurnal ke periode yang ditutup sementara (soft close)",
  },
  { code: "accounting.journals.reverse", description: "Membuat reversal jurnal terposting" },

  { code: "accounting.reports.read", description: "Melihat laporan keuangan" },

  {
    code: "accounting.opening.manage",
    description: "Membuat jurnal saldo awal (opening balance)",
  },
  {
    code: "accounting.closing.manage",
    description: "Membuat jurnal penutup dan menutup tahun fiskal",
  },

  { code: "accounting.cost_centers.read", description: "Melihat pusat biaya" },
  { code: "accounting.cost_centers.manage", description: "Membuat dan mengubah pusat biaya" },

  { code: "accounting.taxes.read", description: "Melihat konfigurasi pajak dan tarif" },
  { code: "accounting.taxes.manage", description: "Mengelola pajak dan tarif bertanggal efektif" },

  { code: "accounting.tax_transactions.read", description: "Melihat transaksi pajak" },
  {
    code: "accounting.tax_transactions.manage",
    description: "Mencatat transaksi pajak (subledger)",
  },

  {
    code: "accounting.bank_accounts.read",
    description: "Melihat rekening kas dan bank",
  },
  {
    code: "accounting.bank_accounts.manage",
    description: "Membuat, mengubah, dan menonaktifkan rekening kas/bank",
  },

  {
    code: "accounting.cash_transactions.read",
    description: "Melihat mutasi (transaksi) kas dan bank",
  },
  {
    code: "accounting.cash_transactions.manage",
    description: "Mencatat, memposting, membatalkan, dan mereversal transaksi kas/bank",
  },

  {
    code: "accounting.budgets.read",
    description: "Melihat anggaran dan realisasi vs anggaran",
  },
  {
    code: "accounting.budgets.manage",
    description: "Membuat, mengubah, dan menyetujui anggaran",
  },

  {
    code: "accounting.bank_reconciliations.read",
    description: "Melihat impor mutasi bank dan rekonsiliasi",
  },
  {
    code: "accounting.bank_reconciliations.manage",
    description: "Mengimpor mutasi, mencocokkan, dan memfinalkan rekonsiliasi bank",
  },
] as const;

export type AccountingPermissionCode = (typeof accountingPermissions)[number]["code"];