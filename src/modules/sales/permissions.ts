/**
 * Daftar permission modul Sales & AR (Tahap 6A). Format: modul.resource.aksi.
 * Mencakup quotation, sales order, delivery, return, credit note, invoice (AR),
 * pembayaran customer, dan laporan.
 */
export const salesPermissions = [
  { code: "sales.quotations.read", description: "Melihat quotation penjualan" },
  { code: "sales.quotations.manage", description: "Membuat/mengubah/membatalkan quotation (draf)" },
  { code: "sales.orders.read", description: "Melihat sales order" },
  { code: "sales.orders.manage", description: "Membuat/mengubah/membatalkan sales order (draf)" },
  { code: "sales.orders.post", description: "Mengajukan, menyetujui, dan memosting sales order" },
  { code: "sales.deliveries.read", description: "Melihat pengiriman barang" },
  { code: "sales.deliveries.manage", description: "Membuat dan memosting pengiriman barang" },
  { code: "sales.returns.read", description: "Melihat retur penjualan" },
  { code: "sales.returns.manage", description: "Membuat dan memosting retur penjualan" },
  { code: "sales.credit_notes.read", description: "Melihat nota kredit" },
  { code: "sales.credit_notes.manage", description: "Membuat/mengubah nota kredit (draf)" },
  { code: "sales.credit_notes.post", description: "Memosting dan mereversal nota kredit" },
  { code: "sales.invoices.read", description: "Melihat faktur penjualan (AR)" },
  { code: "sales.invoices.manage", description: "Membuat/mengubah/membatalkan faktur (draf)" },
  { code: "sales.invoices.post", description: "Memosting dan mereversal faktur penjualan" },
  { code: "sales.payments.read", description: "Melihat pembayaran customer" },
  { code: "sales.payments.manage", description: "Membuat/mengubah/membatalkan pembayaran customer (draf)" },
  { code: "sales.payments.post", description: "Memosting dan mereversal pembayaran customer" },
  { code: "sales.ar.read", description: "Melihat posisi piutang usaha (aging, invoice terbuka)" },
  { code: "sales.reports.read", description: "Melihat laporan penjualan & rekonsiliasi AR-ke-GL" },
] as const;

export type SalesPermissionCode = (typeof salesPermissions)[number]["code"];
