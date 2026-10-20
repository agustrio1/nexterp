import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { actorColumns } from "./_actors";
import { primaryId, timestamps } from "./_columns";
import { branches } from "./organization";

/* ------------------------------------------------------------------ */
/* Tahap 5A: master persediaan (kategori, satuan, konversi, produk)   */
/* ------------------------------------------------------------------ */
// Prinsip: TIDAK ada kolom stok/harga di sini. Stok diturunkan dari transaksi
// (stock ledger, 5E) dengan costing FIFO; kebijakan stok negatif ditolak (5E).

/** Kategori produk berhirarki (self-reference lewat parentId). */
export const productCategories = pgTable(
  "product_categories",
  {
    id: primaryId(),
    code: text().notNull(),
    name: text().notNull(),
    parentId: uuid().references((): AnyPgColumn => productCategories.id),
    isActive: boolean().notNull().default(true),
    description: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("product_categories_code_uq").on(t.code),
    index("product_categories_parent_idx").on(t.parentId),
    check("product_categories_code_chk", sql`length(trim(${t.code})) > 0`),
    check("product_categories_name_chk", sql`length(trim(${t.name})) > 0`),
    check("product_categories_parent_chk", sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
  ],
);

/** Satuan unit of measure master (mis. PCS, BOX, KG). */
export const unitsOfMeasure = pgTable(
  "units_of_measure",
  {
    id: primaryId(),
    code: text().notNull(),
    name: text().notNull(),
    symbol: text(),
    isActive: boolean().notNull().default(true),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("units_of_measure_code_uq").on(t.code),
    check("units_of_measure_code_chk", sql`length(trim(${t.code})) > 0`),
    check("units_of_measure_name_chk", sql`length(trim(${t.name})) > 0`),
  ],
);

/**
 * Konversi antar-satuan global: 1 fromUnit = ratio toUnit (ratio > 0).
 * Contoh PCS->BOX rasio 0.0833 atau BOX->PCS rasio 12. Arah ditentukan dari/to.
 */
export const unitConversions = pgTable(
  "unit_conversions",
  {
    id: primaryId(),
    fromUnitId: uuid()
      .notNull()
      .references(() => unitsOfMeasure.id),
    toUnitId: uuid()
      .notNull()
      .references(() => unitsOfMeasure.id),
    ratio: numeric({ precision: 18, scale: 6 }).notNull(),
    note: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("unit_conversions_from_to_uq").on(t.fromUnitId, t.toUnitId),
    index("unit_conversions_from_idx").on(t.fromUnitId),
    index("unit_conversions_to_idx").on(t.toUnitId),
    check("unit_conversions_ratio_chk", sql`${t.ratio} > 0`),
    check("unit_conversions_no_self_chk", sql`${t.fromUnitId} <> ${t.toUnitId}`),
  ],
);

/**
 * Master produk. `baseUnitId` wajib & aktif; `categoryId` opsional.
 * Tidak ada stok/harga/kolom costing — diturunkan dari transaksi (5E).
 * `tracking` (5E-batch): cara perhitungan satuan per produk; `needsExpiry`
 * memaksa setiap batch produk ber-expiry punya tanggal kedaluwarsa.
 * Keduanya hanya boleh diubah selama produk belum punya pergerakan stok.
 */
export const productTrackingEnum = pgEnum("product_tracking", [
  "none",
  "batch",
  "serial",
  "both",
]);

export const products = pgTable(
  "products",
  {
    id: primaryId(),
    sku: text().notNull(),
    name: text().notNull(),
    categoryId: uuid().references(() => productCategories.id),
    baseUnitId: uuid()
      .notNull()
      .references(() => unitsOfMeasure.id),
    canPurchase: boolean().notNull().default(true),
    canSell: boolean().notNull().default(true),
    isActive: boolean().notNull().default(true),
    tracking: productTrackingEnum().notNull().default("none"),
    needsExpiry: boolean().notNull().default(false),
    reorderPoint: numeric({ precision: 18, scale: 3 }),
    description: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("products_sku_uq").on(t.sku),
    index("products_category_idx").on(t.categoryId),
    index("products_base_unit_idx").on(t.baseUnitId),
    check("products_sku_chk", sql`length(trim(${t.sku})) > 0`),
    check("products_name_chk", sql`length(trim(${t.name})) > 0`),
    check("products_reorder_point_chk", sql`${t.reorderPoint} is null or ${t.reorderPoint} >= 0`),
  ],
);

/* ------------------------------------------------------------------ */
/* Tahap 5B: struktur fisik gudang & lokasi                          */
/* ------------------------------------------------------------------ */
// Master struktur penyimpanan saja. Tidak ada kolom stok — stok muncul di
// stock ledger (5E) sebagai turunan transaksi (product + warehouse + location).

/**
 * Gudang fisik, selalu terikat satu cabang aktif (keputusan 5B).
 * Nonaktif ditolak bila masih punya lokasi aktif (guard stok/transaksi menyusul 5E).
 */
export const warehouses = pgTable(
  "warehouses",
  {
    id: primaryId(),
    code: text().notNull(),
    name: text().notNull(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    isActive: boolean().notNull().default(true),
    address: text(),
    description: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("warehouses_code_uq").on(t.code),
    index("warehouses_branch_idx").on(t.branchId),
    check("warehouses_code_chk", sql`length(trim(${t.code})) > 0`),
    check("warehouses_name_chk", sql`length(trim(${t.name})) > 0`),
  ],
);

/**
 * Lokasi (bin/rak/zona) datar di dalam satu gudang; `code` unik per gudang.
 * Bersifat opsional — gudang boleh tanpa lokasi (stok level gudang, locationId
 * nullable di stock ledger 5E).
 */
export const warehouseLocations = pgTable(
  "warehouse_locations",
  {
    id: primaryId(),
    warehouseId: uuid()
      .notNull()
      .references(() => warehouses.id),
    code: text().notNull(),
    name: text().notNull(),
    isActive: boolean().notNull().default(true),
    description: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("warehouse_locations_warehouse_code_uq").on(t.warehouseId, t.code),
    index("warehouse_locations_warehouse_idx").on(t.warehouseId),
    check("warehouse_locations_code_chk", sql`length(trim(${t.code})) > 0`),
    check("warehouse_locations_name_chk", sql`length(trim(${t.name})) > 0`),
  ],
);

/* ------------------------------------------------------------------ */
/* Tahap 5C: stock ledger + biaya FIFO (mesin, tanpa dokumen)         */
/* ------------------------------------------------------------------ */
// Stok SELALU diturunkan dari `stock_movements` (append-only, dijaga trigger
// imutabilitas di migrasi). Tidak ada kolom saldo pada produk/gudang.
// Valuasi: FIFO per produk+gudang. Lokasi dicatat pada pergerakan tetapi TIDAK
// memisahkan lapisan biaya (keputusan 5C). Stok negatif ditolak di service.

export const stockMovementDirectionEnum = pgEnum("stock_movement_direction", ["in", "out"]);
export const stockSourceTypeEnum = pgEnum("stock_source_type", [
  "opening",
  "goods_receipt",
  "goods_issue",
  "transfer",
  "adjustment",
]);

/**
 * Ledger pergerakan stok (append-only, tidak dapat diubah/dihapus).
 * `quantity` selalu positif; arah dari `direction`. Biaya masuk (>0 boleh nol)
 * membawa lapisan FIFO baru; biaya keluar memakai biaya tertimbang konsumsi layer.
 */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: primaryId(),
    movementDate: date({ mode: "string" }).notNull(),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    warehouseId: uuid()
      .notNull()
      .references(() => warehouses.id),
    locationId: uuid().references(() => warehouseLocations.id),
    direction: stockMovementDirectionEnum().notNull(),
    quantity: numeric({ precision: 18, scale: 3 }).notNull(),
    unitCost: numeric({ precision: 18, scale: 4 }),
    totalCost: numeric({ precision: 18, scale: 2 }),
    batchId: uuid().references(() => stockBatches.id),
    sourceType: stockSourceTypeEnum().notNull(),
    sourceId: uuid(),
    sourceDocNo: text(),
    reverseOfId: uuid().references((): AnyPgColumn => stockMovements.id),
    memo: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("stock_movements_product_warehouse_date_idx").on(t.productId, t.warehouseId, t.movementDate),
    index("stock_movements_reverse_of_idx").on(t.reverseOfId).where(sql`${t.reverseOfId} is not null`),
    check("stock_movements_qty_chk", sql`${t.quantity} > 0`),
    check("stock_movements_in_cost_chk", sql`${t.direction} <> 'in' or ${t.unitCost} is not null`),
    check("stock_movements_unit_cost_chk", sql`${t.unitCost} is null or ${t.unitCost} >= 0`),
  ],
);

/**
 * Lapisan biaya FIFO per produk+gudang. Lahir dari pergerakan masuk, berkurang
 * saat pengeluarankonsumsi FIFO (urut movementDate, id).
 */
export const stockCostLayers = pgTable(
  "stock_cost_layers",
  {
    id: primaryId(),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    warehouseId: uuid()
      .notNull()
      .references(() => warehouses.id),
    receiptMovementId: uuid()
      .notNull()
      .references(() => stockMovements.id),
    movementDate: date({ mode: "string" }).notNull(),
    batchId: uuid().references(() => stockBatches.id),
    expiryDate: date({ mode: "string" }),
    quantityReceived: numeric({ precision: 18, scale: 3 }).notNull(),
    quantityRemaining: numeric({ precision: 18, scale: 3 }).notNull(),
    unitCost: numeric({ precision: 18, scale: 4 }).notNull(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("stock_cost_layers_fifo_idx").on(t.productId, t.warehouseId, t.movementDate, t.id),
    index("stock_cost_layers_fefo_idx").on(t.productId, t.warehouseId, t.expiryDate, t.movementDate, t.id),
    check("stock_cost_layers_recv_chk", sql`${t.quantityReceived} > 0`),
    check(
      "stock_cost_layers_remaining_chk",
      sql`${t.quantityRemaining} >= 0 and ${t.quantityRemaining} <= ${t.quantityReceived}`,
    ),
    check("stock_cost_layers_cost_chk", sql`${t.unitCost} >= 0`),
  ],
);

/**
 * Jejak konsumsi lapisan oleh sebuah pengeluaran (append-only). Memungkinkan
 * audit FIFO penuh dan pemulihan lapisan bila reversal menyusul.
 */
export const stockLayerConsumptions = pgTable(
  "stock_layer_consumptions",
  {
    id: primaryId(),
    issueMovementId: uuid()
      .notNull()
      .references(() => stockMovements.id),
    layerId: uuid()
      .notNull()
      .references(() => stockCostLayers.id),
    quantity: numeric({ precision: 18, scale: 3 }).notNull(),
    unitCost: numeric({ precision: 18, scale: 4 }).notNull(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("stock_layer_consumptions_issue_idx").on(t.issueMovementId),
    index("stock_layer_consumptions_layer_idx").on(t.layerId),
    check("stock_layer_consumptions_qty_chk", sql`${t.quantity} > 0`),
  ],
);

export type StockMovementDirection = (typeof stockMovementDirectionEnum.enumValues)[number];
export type StockSourceType = (typeof stockSourceTypeEnum.enumValues)[number];

/* ------------------------------------------------------------------ */
/* Tahap 5E-batch: batch, expiry, dan serial                          */
/* ------------------------------------------------------------------ */
// Batch dilahirkan inline oleh baris penerimaan (GR) — tidak ada endpoint master.
// Serial didaftarkan mesin posting dan statusnya (in_stock/issued/returned) hanya
// berubah lewat posting/reversal. Kolom stok pada kedua tabel TETAP tidak ada —
// ketersediaan diturunkan dari cost layers / serial itu sendiri per keputusan desain.

/** Status keberadaan unit berserial di dalam gudang. */
export const serialStatusEnum = pgEnum("serial_status", ["in_stock", "issued", "returned"]);

/** Batch per produk (nomor unik per produk); expiry opsional kecuali produk needsExpiry. */
export const stockBatches = pgTable(
  "stock_batches",
  {
    id: primaryId(),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    batchNo: text().notNull(),
    expiryDate: date({ mode: "string" }),
    notes: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("stock_batches_product_batch_no_uq").on(t.productId, t.batchNo),
    index("stock_batches_expiry_idx").on(t.expiryDate),
    check("stock_batches_batch_no_chk", sql`length(trim(${t.batchNo})) > 0`),
  ],
);

/**
 * Unit berserial. `status` in_stock = ada di `warehouseId`; issued/returned = keluar.
 * `movementId` = pergerakan terakhir yang mengubah status (audit mesin).
 */
export const stockSerials = pgTable(
  "stock_serials",
  {
    id: primaryId(),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    batchId: uuid().references(() => stockBatches.id),
    serialNo: text().notNull(),
    status: serialStatusEnum().notNull().default("in_stock"),
    warehouseId: uuid().references(() => warehouses.id),
    movementId: uuid().references((): AnyPgColumn => stockMovements.id),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    uniqueIndex("stock_serials_serial_no_uq").on(t.serialNo),
    index("stock_serials_product_status_idx").on(t.productId, t.status),
    check("stock_serials_serial_no_chk", sql`length(trim(${t.serialNo})) > 0`),
  ],
);

/* ------------------------------------------------------------------ */
/* Tahap 5D: dokumen stok fisik (header + baris, state machine)        */
/* ------------------------------------------------------------------ */
// Dokumen bukan append-only: draf bebas dibentuk, lalu `post` menghasilkan satu atau
// lebih pergerakan ledger via `postStockMovement` (sourceId = id dokumen, sourceDocNo
// = docNo). Koreksi dokumen `posted` lewat reversal: pergerakan penyeimbang dibuat
// (reverseOfId menunjuk pergerakan asal) dan dokumen ditandai `reversed`. Ledger tetap
// append-only. Opname menyimpan qty hasil hitung; saat post dihitung selisih vs posisi
// berjalan lalu dibuat pergerakan penyesuaian (adjustment) ke ledger.

export const stockDocumentTypeEnum = pgEnum("stock_document_type", [
  "receipt",
  "issue",
  "transfer",
  "adjustment",
  "opname",
]);

/** Siklus hidup dokumen stok: draf -> posted; reversed (via reversal) / cancelled (draf). */
export const stockDocumentStatusEnum = pgEnum("stock_document_status", [
  "draft",
  "posted",
  "reversed",
  "cancelled",
]);

/**
 * Header dokumen stok polimorfik. Gudang yang terlibat ditentukan `type`:
 * - receipt: `toWarehouseId` terisi, `fromWarehouseId` kosong.
 * - issue/adjustment/opname: `fromWarehouseId` terisi (gudang kerja), `toWarehouseId` kosong.
 * - transfer: keduanya terisi dan berbeda (asal -> tujuan).
 * `branchId` wajib; kedua gudang harus cabang yang sama & aktif (divalidasi service).
 * `docNo` diisi saat posting (status posted menuntut docNo).
 */
export const stockDocuments = pgTable(
  "stock_documents",
  {
    id: primaryId(),
    docNo: text().unique(),
    type: stockDocumentTypeEnum().notNull(),
    status: stockDocumentStatusEnum().notNull().default("draft"),
    documentDate: date({ mode: "string" }).notNull(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    fromWarehouseId: uuid().references(() => warehouses.id),
    toWarehouseId: uuid().references(() => warehouses.id),
    description: text(),
    reason: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("stock_documents_branch_idx").on(t.branchId),
    index("stock_documents_type_date_idx").on(t.type, t.documentDate),
    check("stock_documents_posted_docno_chk", sql`${t.status} <> 'posted' or ${t.docNo} is not null`),
    check(
      "stock_documents_warehouse_chk",
      sql`(${t.type} = 'receipt' and ${t.toWarehouseId} is not null and ${t.fromWarehouseId} is null)
        or (${t.type} = 'issue' and ${t.fromWarehouseId} is not null and ${t.toWarehouseId} is null)
        or (${t.type} = 'transfer' and ${t.fromWarehouseId} is not null and ${t.toWarehouseId} is not null and ${t.fromWarehouseId} <> ${t.toWarehouseId})
        or (${t.type} in ('adjustment', 'opname') and ${t.fromWarehouseId} is not null and ${t.toWarehouseId} is null)`,
    ),
  ],
);

/**
 * Baris dokumen. `quantity` = qty gerak (receipt/issue/transfer/adjustment) atau qty
 * terhitung (opname). `direction` hanya dipakai untuk adjustment (in/out). `unitCost`
 * wajib untuk baris receipt dan adjustment-in; kosong berarti diturunkan mesin (FIFO).
 */
export const stockDocumentLines = pgTable(
  "stock_document_lines",
  {
    id: primaryId(),
    documentId: uuid()
      .notNull()
      .references(() => stockDocuments.id),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    fromLocationId: uuid().references(() => warehouseLocations.id),
    toLocationId: uuid().references(() => warehouseLocations.id),
    direction: stockMovementDirectionEnum(),
    quantity: numeric({ precision: 18, scale: 3 }).notNull(),
    unitCost: numeric({ precision: 18, scale: 4 }),
    batchNo: text(),
    batchExpiryDate: date({ mode: "string" }),
    batchId: uuid().references(() => stockBatches.id),
    serialNumbers: jsonb(),
    memo: text(),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("stock_document_lines_document_idx").on(t.documentId),
    index("stock_document_lines_product_idx").on(t.productId),
    check("stock_document_lines_qty_chk", sql`${t.quantity} >= 0`),
    check("stock_document_lines_cost_chk", sql`${t.unitCost} is null or ${t.unitCost} >= 0`),
  ],
);

export type StockDocumentType = (typeof stockDocumentTypeEnum.enumValues)[number];
export type StockDocumentStatus = (typeof stockDocumentStatusEnum.enumValues)[number];
export type ProductTracking = (typeof productTrackingEnum.enumValues)[number];
export type SerialStatus = (typeof serialStatusEnum.enumValues)[number];
