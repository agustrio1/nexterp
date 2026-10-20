/**
 * Daftar permission modul Purchasing (Tahap 5F procurement). Format: modul.resource.aksi.
 * Penerimaan dari PO memakai izin `purchasing.receipts.*`; mesin stok internal
 * (`inventory.documents.manage`) tetap dibutuhkan operator karena GR ditulis lewat
 * engine dokumen 5D — keduanya diberikan bersama pada peran purchasing/warehouse.
 */
export const purchasingPermissions = [
  { code: "purchasing.payment_terms.read", description: "Melihat termin pembayaran" },
  { code: "purchasing.payment_terms.manage", description: "Mengelola termin pembayaran" },
  { code: "purchasing.suppliers.read", description: "Melihat master pemasok" },
  { code: "purchasing.suppliers.manage", description: "Mengelola master pemasok" },
  { code: "purchasing.purchase_orders.read", description: "Melihat purchase order" },
  { code: "purchasing.purchase_orders.manage", description: "Membuat/mengubah/membatalkan purchase order (draf)" },
  { code: "purchasing.purchase_orders.post", description: "Mengajukan, menyetujui, dan memosting purchase order" },
  { code: "purchasing.receipts.read", description: "Melihat penerimaan barang dari PO" },
  { code: "purchasing.receipts.manage", description: "Membuat dan memosting penerimaan barang dari PO" },
  { code: "purchasing.invoices.read", description: "Melihat invoice pemasok (AP)" },
  { code: "purchasing.invoices.manage", description: "Membuat/mengubah/membatalkan invoice pemasok (draf)" },
  { code: "purchasing.invoices.post", description: "Memosting dan mereversal invoice pemasok (jurnal GR/IR)" },
  { code: "purchasing.payments.read", description: "Melihat pembayaran AP" },
  { code: "purchasing.payments.manage", description: "Membuat/mengubah/membatalkan pembayaran AP (draf)" },
  { code: "purchasing.payments.post", description: "Memosting dan mereversal pembayaran AP (jurnal Dr AP/Cr Bank)" },
  { code: "purchasing.ap.read", description: "Melihat posisi utang usaha (invoice terbuka, aging)" },
  { code: "purchasing.reports.read", description: "Melihat laporan pembelian & rekonsiliasi AP-ke-GL" },
] as const;

export type PurchasingPermissionCode = (typeof purchasingPermissions)[number]["code"];
