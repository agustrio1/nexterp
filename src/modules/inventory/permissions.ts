/**
 * Daftar permission modul Inventory (Tahap 5). Format: modul.resource.aksi.
 * Konversi satuan dikelola lewat izin `inventory.units`.
 */
export const inventoryPermissions = [
  { code: "inventory.product_categories.read", description: "Melihat kategori produk" },
  { code: "inventory.product_categories.manage", description: "Mengelola kategori produk" },
  { code: "inventory.units.read", description: "Melihat satuan dan konversi satuan" },
  { code: "inventory.units.manage", description: "Mengelola satuan dan konversi satuan" },
  { code: "inventory.products.read", description: "Melihat master produk" },
  { code: "inventory.products.manage", description: "Mengelola master produk" },
  { code: "inventory.warehouses.read", description: "Melihat gudang dan lokasi" },
  { code: "inventory.warehouses.manage", description: "Mengelola gudang dan lokasi" },
  { code: "inventory.stock.read", description: "Melihat stock ledger dan posisi stok" },
  { code: "inventory.stock.manage", description: "Mencatat pergerakan stok (ledger FIFO)" },
  { code: "inventory.documents.read", description: "Melihat dokumen stok (receipt/issue/transfer/adjustment/opname)" },
  { code: "inventory.documents.manage", description: "Mengelola dan memposting dokumen stok" },
] as const;

export type InventoryPermissionCode = (typeof inventoryPermissions)[number]["code"];
