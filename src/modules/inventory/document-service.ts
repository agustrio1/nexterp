import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  branches,
  products,
  stockBatches,
  stockCostLayers,
  stockDocumentLines,
  stockDocuments,
  stockMovements,
  stockSerials,
  warehouseLocations,
  warehouses,
  type ProductTracking,
  type StockDocumentType,
  type StockMovementDirection,
  type StockSourceType,
} from "@/db/schema";
import {
  cancelStockDocumentSchema,
  createStockDocumentSchema,
  listStockDocumentsQuerySchema,
  postStockMovementInputSchema,
  reverseStockDocumentSchema,
  type CancelStockDocumentInput,
  type CreateStockDocumentInput,
  type ListStockDocumentsQuery,
  type PostStockMovementInput,
  type ReverseStockDocumentInput,
} from "@/modules/inventory/schemas";
import { postStockMovement } from "@/modules/inventory/stock-service";
import { cmp, sub, toDb } from "@/lib/money";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { businessRule, forbidden, notFound, validationFailed } from "@/server/errors";
import { nextDocumentNumber, type NumberedDocType } from "@/server/numbering";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "select">;

const QTY_DP = 3;

/**
 * Mesin dokumen stok (Tahap 5D + 5E-batch). Dokumen polimorfik 1 header + N baris
 * dengan state machine draf -> posted (-> reversed | cancelled). Posting tidak
 * menulis ledger sendiri: setiap pergerakan didelegasikan ke `postStockMovement`
 * (mesin FEFO/FIFO 5C) supaya costing tetap satu sumber.
 *
 * 5E-batch: batch dilahirkan INLINE oleh baris penerimaan (nomor + expiry di
 * baris GR); serial didaftarkan/dikeluarkan mesin saat posting/reversal.
 * Aturan expiry (keputusan): konsumsi auto MELEWATI batch expired; batch
 * eksplisit yang expired ditolak; penerimaan batch sudah expired ditolak;
 * pergerakan reversal (reverseOfId terisi) dibebaskan dari aturan expiry.
 */

/** Per jenis dokumen: sumber ledger + aturan penomoran. */
const SOURCE_BY_TYPE: Record<StockDocumentType, StockSourceType> = {
  receipt: "goods_receipt",
  issue: "goods_issue",
  transfer: "transfer",
  adjustment: "adjustment",
  opname: "adjustment",
};

const NUMBERING_BY_TYPE: Record<StockDocumentType, NumberedDocType> = {
  receipt: "goods_receipt",
  issue: "goods_issue",
  transfer: "stock_transfer",
  adjustment: "stock_adjustment",
  opname: "stock_opname",
};

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

function usesBatch(tracking: ProductTracking): boolean {
  return tracking === "batch" || tracking === "both";
}

function usesSerial(tracking: ProductTracking): boolean {
  return tracking === "serial" || tracking === "both";
}

function lineSerials(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/* ----------------------------- Validasi referensi ---------------------------- */

type ProductInfo = { id: string; isActive: boolean; tracking: ProductTracking; needsExpiry: boolean };

async function requireActiveProduct(tx: Tx, productId: string, path: string): Promise<ProductInfo> {
  const [row] = await tx
    .select({
      id: products.id,
      isActive: products.isActive,
      tracking: products.tracking,
      needsExpiry: products.needsExpiry,
    })
    .from(products)
    .where(eq(products.id, productId))
    .for("share")
    .limit(1);
  if (!row) throw validationFailed([{ path, message: "Produk tidak ditemukan." }]);
  if (!row.isActive) throw businessRule("Produk tidak aktif.");
  return row;
}

async function fetchProductsInfo(tx: Tx, ids: readonly string[]): Promise<Map<string, ProductInfo>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({
      id: products.id,
      isActive: products.isActive,
      tracking: products.tracking,
      needsExpiry: products.needsExpiry,
    })
    .from(products)
    .where(inArray(products.id, [...new Set(ids)]))
    .for("share");
  return new Map(rows.map((r) => [r.id, r]));
}

/** Gudang aktif milik cabang dokumen; path menandai lokasi error yang tepat. */
async function requireDocWarehouse(
  tx: Tx,
  warehouseId: string,
  path: string,
  branchId: string,
): Promise<void> {
  const [row] = await tx
    .select({ id: warehouses.id, branchId: warehouses.branchId, isActive: warehouses.isActive })
    .from(warehouses)
    .where(eq(warehouses.id, warehouseId))
    .for("share")
    .limit(1);
  if (!row) throw validationFailed([{ path, message: "Gudang tidak ditemukan." }]);
  if (row.branchId !== branchId) {
    throw validationFailed([{ path, message: "Gudang bukan milik cabang dokumen." }]);
  }
  if (!row.isActive) throw businessRule("Gudang tidak aktif.");
}

/** Lokasi harus aktif & berada di dalam gudang `warehouseId` yang ditentukan. */
async function requireLocationBelongsTo(
  tx: Tx,
  locationId: string,
  warehouseId: string,
  path: string,
): Promise<void> {
  const [row] = await tx
    .select({
      id: warehouseLocations.id,
      warehouseId: warehouseLocations.warehouseId,
      isActive: warehouseLocations.isActive,
    })
    .from(warehouseLocations)
    .where(eq(warehouseLocations.id, locationId))
    .for("share")
    .limit(1);
  if (!row) throw validationFailed([{ path, message: "Lokasi tidak ditemukan." }]);
  if (row.warehouseId !== warehouseId) throw businessRule("Lokasi bukan milik gudang dokumen ini.");
  if (!row.isActive) throw businessRule("Lokasi tidak aktif.");
}

function requirePositive(quantity: string, path: string): void {
  if (cmp(quantity, 0) <= 0) {
    throw validationFailed([{ path, message: "Kuantitas baris harus lebih dari nol." }]);
  }
}

/* --------------------------------- Batch ---------------------------------- */

type BatchRef = { id: string; expiryDate: string | null };

async function resolveBatchByNo(
  tx: Tx,
  productId: string,
  batchNo: string,
): Promise<BatchRef | null> {
  const [row] = await tx
    .select({ id: stockBatches.id, expiryDate: stockBatches.expiryDate })
    .from(stockBatches)
    .where(and(eq(stockBatches.productId, productId), eq(stockBatches.batchNo, batchNo)))
    .limit(1);
  return row ?? null;
}

/** Batch yang disebut eksplisit (id) harus ada dan milik produk. */
async function requireBatchById(tx: Tx, productId: string, batchId: string, path: string): Promise<BatchRef> {
  const [row] = await tx
    .select({ id: stockBatches.id, productId: stockBatches.productId, expiryDate: stockBatches.expiryDate })
    .from(stockBatches)
    .where(eq(stockBatches.id, batchId))
    .limit(1);
  if (!row) throw validationFailed([{ path, message: "Batch tidak ditemukan." }]);
  if (row.productId !== productId) {
    throw validationFailed([{ path, message: "Batch bukan milik produk ini." }]);
  }
  return { id: row.id, expiryDate: row.expiryDate };
}

/**
 * Batch untuk baris MASUK (receipt/adjustment-in): pakai yang sudah ada atau
 * lahirkan inline. Mencek konsistensi expiry, kebutuhan expiry produk, dan
 * menolak batch yang sudah kedaluwarsa terhadap tanggal dokumen.
 */
async function ensureBatchForInbound(
  tx: Tx,
  actor: AuthContext,
  opts: {
    productId: string;
    batchNo: string;
    expiryDate: string | null;
    needsExpiry: boolean;
    documentDate: string;
    path: string;
  },
): Promise<BatchRef> {
  const existing = await resolveBatchByNo(tx, opts.productId, opts.batchNo);
  if (existing) {
    if (opts.expiryDate && existing.expiryDate && opts.expiryDate !== existing.expiryDate) {
      throw validationFailed([
        { path: `${opts.path}.batchExpiryDate`, message: "Nomor batch sudah terdaftar dengan expiry berbeda." },
      ]);
    }
    const effective = existing.expiryDate ?? opts.expiryDate ?? null;
    if (!existing.expiryDate && opts.expiryDate) {
      await tx
        .update(stockBatches)
        .set({ expiryDate: opts.expiryDate, updatedAt: new Date(), updatedBy: actor.userId })
        .where(eq(stockBatches.id, existing.id));
    }
    if (opts.needsExpiry && !effective) {
      throw validationFailed([
        { path: `${opts.path}.batchExpiryDate`, message: "Batch produk ber-expiry wajib punya tanggal expiry." },
      ]);
    }
    if (effective !== null && effective < opts.documentDate) {
      throw businessRule("Batch sudah kedaluwarsa terhadap tanggal dokumen; penerimaan ditolak.");
    }
    return { id: existing.id, expiryDate: effective };
  }

  if (opts.needsExpiry && !opts.expiryDate) {
    throw validationFailed([
      { path: `${opts.path}.batchExpiryDate`, message: "Batch produk ber-expiry wajib punya tanggal expiry." },
    ]);
  }
  if (opts.expiryDate && opts.expiryDate < opts.documentDate) {
    throw businessRule("Batch sudah kedaluwarsa terhadap tanggal dokumen; penerimaan ditolak.");
  }

  const [created] = await tx
    .insert(stockBatches)
    .values({
      productId: opts.productId,
      batchNo: opts.batchNo,
      expiryDate: opts.expiryDate,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    })
    .returning({ id: stockBatches.id });
  if (!created) throw new Error("Gagal membuat batch.");
  return { id: created.id, expiryDate: opts.expiryDate };
}

/* --------------------------------- Serial --------------------------------- */

type SerialRow = {
  id: string;
  productId: string;
  batchId: string | null;
  serialNo: string;
  status: "in_stock" | "issued" | "returned";
  warehouseId: string | null;
};

async function lockSerials(tx: Tx, serialNos: readonly string[]): Promise<SerialRow[]> {
  if (serialNos.length === 0) return [];
  return tx
    .select({
      id: stockSerials.id,
      productId: stockSerials.productId,
      batchId: stockSerials.batchId,
      serialNo: stockSerials.serialNo,
      status: stockSerials.status,
      warehouseId: stockSerials.warehouseId,
    })
    .from(stockSerials)
    .where(inArray(stockSerials.serialNo, [...serialNos]))
    .orderBy(stockSerials.serialNo)
    .for("update");
}

/** Daftarkan unit baru hasil pergerakan masuk (receipt/adjust-in/opname gain). */
async function registerSerials(
  tx: Tx,
  actor: AuthContext,
  opts: { productId: string; batchId: string | null; warehouseId: string; movementId: string; serials: string[]; path: string },
): Promise<void> {
  const existing = await lockSerials(tx, opts.serials);
  if (existing.length > 0) {
    throw validationFailed([
      {
        path: `${opts.path}.serialNumbers`,
        message: `Nomor serial sudah terdaftar: ${existing.map((s) => s.serialNo).join(", ")}.`,
      },
    ]);
  }
  await tx.insert(stockSerials).values(
    opts.serials.map((serialNo) => ({
      productId: opts.productId,
      batchId: opts.batchId,
      serialNo,
      status: "in_stock" as const,
      warehouseId: opts.warehouseId,
      movementId: opts.movementId,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    })),
  );
}

/** Keluarkan unit yang disebut (issue/adjust-out/loss opname). */
async function markSerialsIssued(
  tx: Tx,
  actor: AuthContext,
  opts: {
    productId: string;
    warehouseId: string;
    batchId: string | null;
    movementId: string;
    serials: string[];
    path: string;
  },
): Promise<void> {
  const rows = await lockSerials(tx, opts.serials);
  const byNo = new Map(rows.map((r) => [r.serialNo, r]));
  for (const serialNo of opts.serials) {
    const row = byNo.get(serialNo);
    if (!row) {
      throw validationFailed([{ path: `${opts.path}.serialNumbers`, message: `Serial tidak ditemukan: ${serialNo}.` }]);
    }
    if (row.productId !== opts.productId) {
      throw validationFailed([{ path: `${opts.path}.serialNumbers`, message: `Serial bukan milik produk ini: ${serialNo}.` }]);
    }
    if (opts.batchId !== null && row.batchId !== opts.batchId) {
      throw businessRule(`Serial ${serialNo} bukan milik batch dokumen ini.`);
    }
    if (row.status !== "in_stock" || row.warehouseId !== opts.warehouseId) {
      throw businessRule(`Serial ${serialNo} tidak tersedia di gudang sumber.`);
    }
  }
  await tx
    .update(stockSerials)
    .set({ status: "issued", movementId: opts.movementId, updatedAt: new Date(), updatedBy: actor.userId })
    .where(inArray(stockSerials.serialNo, opts.serials));
}

/** Kembalikan unit ke in_stock di gudang tertentu (reversal pengeluaran). */
async function markSerialsInStock(
  tx: Tx,
  actor: AuthContext,
  ids: readonly string[],
  opts: { warehouseId: string; movementId: string },
): Promise<void> {
  if (ids.length === 0) return;
  await tx
    .update(stockSerials)
    .set({
      status: "in_stock",
      warehouseId: opts.warehouseId,
      movementId: opts.movementId,
      updatedAt: new Date(),
      updatedBy: actor.userId,
    })
    .where(inArray(stockSerials.id, [...ids]));
}

/**
 * Pindahkan unit antar gudang hasil transfer-in: status tetap in_stock,
 * gudang berpindah, pergerakan pemilik = pergerakan masuk di tujuan.
 */
async function moveSerialsTo(
  tx: Tx,
  actor: AuthContext,
  opts: { productId: string; fromWarehouseId: string; toWarehouseId: string; batchId: string | null; movementId: string; serials: string[]; path: string },
): Promise<void> {
  const rows = await lockSerials(tx, opts.serials);
  const byNo = new Map(rows.map((r) => [r.serialNo, r]));
  for (const serialNo of opts.serials) {
    const row = byNo.get(serialNo);
    if (!row) {
      throw validationFailed([{ path: `${opts.path}.serialNumbers`, message: `Serial tidak ditemukan: ${serialNo}.` }]);
    }
    if (row.productId !== opts.productId) {
      throw validationFailed([{ path: `${opts.path}.serialNumbers`, message: `Serial bukan milik produk ini: ${serialNo}.` }]);
    }
    if (opts.batchId !== null && row.batchId !== opts.batchId) {
      throw businessRule(`Serial ${serialNo} bukan milik batch dokumen ini.`);
    }
    if (row.status !== "in_stock" || row.warehouseId !== opts.fromWarehouseId) {
      throw businessRule(`Serial ${serialNo} tidak tersedia di gudang asal transfer.`);
    }
  }
  await tx
    .update(stockSerials)
    .set({
      warehouseId: opts.toWarehouseId,
      movementId: opts.movementId,
      updatedAt: new Date(),
      updatedBy: actor.userId,
    })
    .where(inArray(stockSerials.serialNo, opts.serials));
}

/* ------------------------------ Kaidah bentuk ------------------------------ */

/**
 * Kaidah bentuk per jenis dokumen (fail-closed, dipakai saat create & post):
 * kombinasi gudang + baris, biaya wajib receipt/adjust-in, qty positif,
 * kepemilikan lokasi, dan aturan batch/serial per tracking produk.
 */
async function validateStockDocumentShape(tx: Tx, doc: CreateStockDocumentInput): Promise<void> {
  const { type, branchId, fromWarehouseId, toWarehouseId, lines } = doc;

  if (type === "receipt") {
    if (!toWarehouseId || fromWarehouseId) {
      throw validationFailed([
        { path: "toWarehouseId", message: "Penerimaan wajib menetapkan gudang tujuan saja." },
      ]);
    }
    await requireDocWarehouse(tx, toWarehouseId, "toWarehouseId", branchId);
  } else if (type === "transfer") {
    if (!fromWarehouseId || !toWarehouseId) {
      throw validationFailed([
        { path: "fromWarehouseId", message: "Transfer wajib menetapkan gudang asal dan tujuan." },
      ]);
    }
    if (fromWarehouseId === toWarehouseId) {
      throw validationFailed([
        { path: "toWarehouseId", message: "Gudang asal dan tujuan transfer harus berbeda." },
      ]);
    }
    await requireDocWarehouse(tx, fromWarehouseId, "fromWarehouseId", branchId);
    await requireDocWarehouse(tx, toWarehouseId, "toWarehouseId", branchId);
  } else {
    if (!fromWarehouseId || toWarehouseId) {
      throw validationFailed([
        { path: "fromWarehouseId", message: `Dokumen ${type} wajib menetapkan gudang asal saja.` },
      ]);
    }
    await requireDocWarehouse(tx, fromWarehouseId, "fromWarehouseId", branchId);
  }

  for (const [index, line] of lines.entries()) {
    const linePath = `lines.${index}`;
    const product = await requireActiveProduct(tx, line.productId, `${linePath}.productId`);
    const inbound =
      type === "receipt" || (type === "adjustment" && (line.direction ?? "out") === "in");

    if (line.fromLocationId != null && fromWarehouseId != null) {
      await requireLocationBelongsTo(tx, line.fromLocationId, fromWarehouseId, `${linePath}.fromLocationId`);
    }
    if (line.toLocationId != null && toWarehouseId != null) {
      await requireLocationBelongsTo(tx, line.toLocationId, toWarehouseId, `${linePath}.toLocationId`);
    }

    if (type === "opname") {
      // qty terhitung >= 0 (regex); tanpa biaya/arah dari pengguna.
    } else {
      requirePositive(line.quantity, `${linePath}.quantity`);
      if ((type === "receipt" || (type === "adjustment" && inbound)) && line.unitCost == null) {
        throw validationFailed([
          {
            path: `${linePath}.unitCost`,
            message: inbound && type === "adjustment"
              ? "Penyesuaian masuk wajib menyertakan biaya satuan."
              : "Baris penerimaan wajib menyertakan biaya satuan.",
          },
        ]);
      }
    }

    /* ------------------------- Aturan batch/serial ------------------------- */
    const batchInput = line.batchNo !== undefined || line.batchId != null;
    const serialInput = line.serialNumbers !== undefined;
    if (product.tracking === "none" && (batchInput || serialInput)) {
      throw validationFailed([
        { path: linePath, message: "Produk tanpa tracking tidak menerima batch/nomor serial." },
      ]);
    }

    if (usesBatch(product.tracking)) {
      if (inbound) {
        if (!line.batchNo || line.batchId != null) {
          throw validationFailed([
            { path: `${linePath}.batchNo`, message: "Baris masuk produk ber-batch wajib memakai batchNo (bukan batchId)." },
          ]);
        }
        if (product.needsExpiry && !line.batchExpiryDate) {
          const existing = await resolveBatchByNo(tx, line.productId, line.batchNo);
          if (!existing?.expiryDate) {
            throw validationFailed([
              { path: `${linePath}.batchExpiryDate`, message: "Batch produk ber-expiry wajib punya tanggal expiry." },
            ]);
          }
        }
        if (line.batchExpiryDate && line.batchExpiryDate < doc.documentDate) {
          throw businessRule("Batch sudah kedaluwarsa terhadap tanggal dokumen; penerimaan ditolak.");
        }
      } else {
        if (line.batchNo && line.batchId != null) {
          throw validationFailed([
            { path: `${linePath}.batchId`, message: "Gunakan salah satu: batchNo atau batchId." },
          ]);
        }
        const batch = line.batchId != null
          ? await requireBatchById(tx, line.productId, line.batchId, `${linePath}.batchId`)
          : line.batchNo !== undefined
            ? await resolveBatchByNo(tx, line.productId, line.batchNo)
            : null;
        if (line.batchNo !== undefined && !batch) {
          throw validationFailed([{ path: `${linePath}.batchNo`, message: "Batch belum terdaftar untuk produk ini." }]);
        }
        if (batch && batch.expiryDate !== null && batch.expiryDate < doc.documentDate) {
          throw businessRule("Batch pilihan sudah kedaluwarsa; pengeluaran ditolak.");
        }
        if ((type === "opname" || type === "transfer") && !batch) {
          throw validationFailed([
            {
              path: `${linePath}.batchNo`,
              message: type === "opname"
                ? "Opname produk ber-batch wajib per batch."
                : "Transfer produk ber-batch wajib menyebut batch agar identitas terjaga.",
            },
          ]);
        }
      }
    } else if (batchInput) {
      throw validationFailed([
        { path: linePath, message: "Produk ini tidak melacak batch." },
      ]);
    }

    if (usesSerial(product.tracking)) {
      const serials = line.serialNumbers ?? [];
      if (serials.length === 0) {
        throw validationFailed([
          { path: `${linePath}.serialNumbers`, message: "Baris produk berserial wajib mencantumkan nomor serial." },
        ]);
      }
      if (new Set(serials).size !== serials.length) {
        throw validationFailed([
          { path: `${linePath}.serialNumbers`, message: "Nomor serial duplikat dalam satu baris." },
        ]);
      }
      if (cmp(line.quantity, String(serials.length)) !== 0) {
        throw validationFailed([
          {
            path: `${linePath}.quantity`,
            message: `Kuantitas harus sama dengan jumlah nomor serial (${serials.length}).`,
          },
        ]);
      }
    } else if (serialInput) {
      throw validationFailed([
        { path: `${linePath}.serialNumbers`, message: "Produk ini tidak melacak serial." },
      ]);
    }
  }
}

/* ------------------------------ Pembaca bersama ------------------------------ */

const whFrom = alias(warehouses, "fromWh");
const whTo = alias(warehouses, "toWh");
const locFrom = alias(warehouseLocations, "fromLoc");
const locTo = alias(warehouseLocations, "toLoc");
const lineBatch = alias(stockBatches, "lineBatch");

function documentQuery(reader: Reader) {
  return reader
    .select({
      id: stockDocuments.id,
      docNo: stockDocuments.docNo,
      type: stockDocuments.type,
      status: stockDocuments.status,
      documentDate: stockDocuments.documentDate,
      branchId: stockDocuments.branchId,
      branchCode: branches.code,
      branchName: branches.name,
      fromWarehouseId: stockDocuments.fromWarehouseId,
      fromWarehouseCode: whFrom.code,
      fromWarehouseName: whFrom.name,
      toWarehouseId: stockDocuments.toWarehouseId,
      toWarehouseCode: whTo.code,
      toWarehouseName: whTo.name,
      description: stockDocuments.description,
      reason: stockDocuments.reason,
      createdAt: stockDocuments.createdAt,
      updatedAt: stockDocuments.updatedAt,
    })
    .from(stockDocuments)
    .innerJoin(branches, eq(branches.id, stockDocuments.branchId))
    .leftJoin(whFrom, eq(whFrom.id, stockDocuments.fromWarehouseId))
    .leftJoin(whTo, eq(whTo.id, stockDocuments.toWarehouseId));
}

async function readLines(reader: Reader, documentId: string) {
  return reader
    .select({
      id: stockDocumentLines.id,
      documentId: stockDocumentLines.documentId,
      productId: stockDocumentLines.productId,
      productSku: products.sku,
      productName: products.name,
      fromLocationId: stockDocumentLines.fromLocationId,
      fromLocationCode: locFrom.code,
      toLocationId: stockDocumentLines.toLocationId,
      toLocationCode: locTo.code,
      direction: stockDocumentLines.direction,
      quantity: stockDocumentLines.quantity,
      unitCost: stockDocumentLines.unitCost,
      batchNo: stockDocumentLines.batchNo,
      batchExpiryDate: stockDocumentLines.batchExpiryDate,
      batchId: stockDocumentLines.batchId,
      batchExpiryDateResolved: lineBatch.expiryDate,
      serialNumbers: stockDocumentLines.serialNumbers,
      memo: stockDocumentLines.memo,
    })
    .from(stockDocumentLines)
    .innerJoin(products, eq(products.id, stockDocumentLines.productId))
    .leftJoin(locFrom, eq(locFrom.id, stockDocumentLines.fromLocationId))
    .leftJoin(locTo, eq(locTo.id, stockDocumentLines.toLocationId))
    .leftJoin(lineBatch, eq(lineBatch.id, stockDocumentLines.batchId))
    .where(eq(stockDocumentLines.documentId, documentId))
    .orderBy(stockDocumentLines.id);
}

/** Ambil header (dengan nama cabang/gudang) + baris; 404 bila tidak ada. */
async function requireStockDocument(reader: Reader, id: string) {
  const [header] = await documentQuery(reader).where(eq(stockDocuments.id, id)).limit(1);
  if (!header) throw notFound("Dokumen stok tidak ditemukan.");
  const lines = await readLines(reader, id);
  return { ...header, lines };
}

/**
 * Kunci baris header (FOR UPDATE) untuk operasi transisi status. FOR UPDATE tidak
 * boleh digabung LEFT JOIN, jadi kunci baris telanjang lalu ambil data terlengkap
 * via `requireStockDocument`. Mencegah balapan posting/cancel/reverse ganda.
 */
async function lockDocumentHeader(tx: Tx, id: string) {
  const [raw] = await tx
    .select()
    .from(stockDocuments)
    .where(eq(stockDocuments.id, id))
    .for("update")
    .limit(1);
  if (!raw) throw notFound("Dokumen stok tidak ditemukan.");
  const doc = await requireStockDocument(tx, id);
  return { raw, doc };
}

/* -------------------------------- Emit gerak -------------------------------- */

/**
 * Susun input pergerakan lalu validasi lewat skema mesin 5C. Arah 'in' wajib
 * unitCost; arah 'out' membiarkan biaya ditentukan mesin (FEFO/FIFO).
 */
function buildMovementInput(spec: {
  productId: string;
  warehouseId: string;
  locationId?: string | null;
  direction: StockMovementDirection;
  quantity: string;
  unitCost?: string | null;
  movementDate: string;
  sourceType: StockSourceType;
  sourceId: string;
  sourceDocNo: string;
  reverseOfId?: string | null;
  batchId?: string | null;
  memo?: string | null;
}): PostStockMovementInput {
  return postStockMovementInputSchema.parse({
    productId: spec.productId,
    warehouseId: spec.warehouseId,
    locationId: spec.locationId ?? null,
    direction: spec.direction,
    quantity: spec.quantity,
    unitCost: spec.unitCost ?? null,
    movementDate: spec.movementDate,
    sourceType: spec.sourceType,
    sourceId: spec.sourceId,
    sourceDocNo: spec.sourceDocNo,
    reverseOfId: spec.reverseOfId ?? null,
    batchId: spec.batchId ?? null,
    memo: spec.memo ?? null,
  });
}

/* ------------------------------- Create -------------------------------- */

/** Membuat dokumen status draf (header + baris). Belum ada pergerakan ledger. */
export async function createStockDocument(
  actor: AuthContext,
  input: CreateStockDocumentInput,
  externalTx?: Tx,
) {
  assertCan(actor, "inventory.documents.manage");
  const parsed = createStockDocumentSchema.parse(input);

  const run = async (tx: Tx) => {
    await validateStockDocumentShape(tx, parsed);

    const [header] = await tx
      .insert(stockDocuments)
      .values({
        type: parsed.type,
        status: "draft",
        documentDate: parsed.documentDate,
        branchId: parsed.branchId,
        fromWarehouseId: parsed.fromWarehouseId ?? null,
        toWarehouseId: parsed.toWarehouseId ?? null,
        description: parsed.description ?? null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: stockDocuments.id });
    if (!header) throw new Error("Gagal membuat dokumen stok.");

    await tx.insert(stockDocumentLines).values(
      parsed.lines.map((line) => ({
        documentId: header.id,
        productId: line.productId,
        fromLocationId: line.fromLocationId ?? null,
        toLocationId: line.toLocationId ?? null,
        direction: line.direction ?? null,
        quantity: toDb(line.quantity, QTY_DP),
        unitCost: line.unitCost ?? null,
        batchNo: line.batchNo ?? null,
        batchExpiryDate: line.batchExpiryDate ?? null,
        batchId: null,
        serialNumbers: line.serialNumbers ?? null,
        memo: line.memo ?? null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })),
    );

    await audit.log(
      {
        action: "stock_document.create",
        entityType: "stock_document",
        entityId: header.id,
        actorId: actor.userId,
        after: { type: parsed.type, branchId: parsed.branchId, lineCount: parsed.lines.length },
      },
      tx,
    );

    return requireStockDocument(tx, header.id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}


/* ============================ TAHAP 5E-batch: Post ============================ */

/** Petakan baris tersimpan kembali ke bentuk input untuk validasi ulang saat post. */
function linesToInput(
  raw: {
    type: StockDocumentType;
    documentDate: string;
    branchId: string;
    fromWarehouseId: string | null;
    toWarehouseId: string | null;
    description: string | null;
  },
  lines: {
    productId: string;
    fromLocationId: string | null;
    toLocationId: string | null;
    direction: StockMovementDirection | null;
    quantity: string;
    unitCost: string | null;
    batchNo: string | null;
    batchExpiryDate: string | null;
    batchId: string | null;
    serialNumbers: unknown;
    memo: string | null;
  }[],
): CreateStockDocumentInput {
  return {
    type: raw.type,
    documentDate: raw.documentDate,
    branchId: raw.branchId,
    fromWarehouseId: raw.fromWarehouseId ?? undefined,
    toWarehouseId: raw.toWarehouseId ?? undefined,
    description: raw.description ?? undefined,
    lines: lines.map((line) => {
      const serials = lineSerials(line.serialNumbers);
      return {
        productId: line.productId,
        fromLocationId: line.fromLocationId ?? undefined,
        toLocationId: line.toLocationId ?? undefined,
        direction: line.direction ?? undefined,
        quantity: line.quantity,
        unitCost: line.unitCost ?? undefined,
        batchNo: line.batchNo ?? undefined,
        batchExpiryDate: line.batchExpiryDate ?? undefined,
        batchId: line.batchId ?? undefined,
        serialNumbers: serials.length > 0 ? serials : undefined,
        memo: line.memo ?? undefined,
      };
    }),
  };
}

function needWh(value: string | null, label: string): string {
  if (!value) throw businessRule(`${label} belum ditetapkan pada dokumen.`);
  return value;
}

/** Batch untuk baris MASUK: lahirkan/pakai batch lalu tautkan ke baris. */
async function resolveInboundBatch(
  tx: Tx,
  actor: AuthContext,
  opts: {
    productId: string;
    line: { id: string; batchNo: string | null; batchExpiryDate: string | null };
    product: ProductInfo;
    documentDate: string;
    path: string;
  },
): Promise<string | null> {
  if (!usesBatch(opts.product.tracking)) return null;
  const batchNo = opts.line.batchNo;
  if (!batchNo) {
    throw validationFailed([
      { path: `${opts.path}.batchNo`, message: "Baris masuk produk ber-batch wajib memakai batchNo." },
    ]);
  }
  const b = await ensureBatchForInbound(tx, actor, {
    productId: opts.productId,
    batchNo,
    expiryDate: opts.line.batchExpiryDate,
    needsExpiry: opts.product.needsExpiry,
    documentDate: opts.documentDate,
    path: `${opts.path}.batchNo`,
  });
  await tx
    .update(stockDocumentLines)
    .set({ batchId: b.id })
    .where(eq(stockDocumentLines.id, opts.line.id));
  return b.id;
}

/** Batch untuk baris KELUAR: pakai batchId/batchNo yang sudah terdaftar (atau null). */
async function resolveOutboundBatch(
  tx: Tx,
  productId: string,
  line: { batchNo: string | null; batchId: string | null },
  path: string,
): Promise<string | null> {
  if (line.batchId != null) {
    const b = await requireBatchById(tx, productId, line.batchId, `${path}.batchId`);
    return b.id;
  }
  if (line.batchNo) {
    const b = await resolveBatchByNo(tx, productId, line.batchNo);
    if (!b) {
      throw validationFailed([
        { path: `${path}.batchNo`, message: "Batch belum terdaftar untuk produk ini." },
      ]);
    }
    return b.id;
  }
  return null;
}

/** Sisa on-hand per lapisan biaya (otoritatif untuk opname); batch opsional. */
async function expectedRemaining(
  tx: Tx,
  productId: string,
  warehouseId: string,
  batchId?: string | null,
): Promise<string> {
  const conditions = [
    eq(stockCostLayers.productId, productId),
    eq(stockCostLayers.warehouseId, warehouseId),
    batchId === undefined
      ? undefined
      : batchId === null
        ? isNull(stockCostLayers.batchId)
        : eq(stockCostLayers.batchId, batchId),
  ];
  const [row] = await tx
    .select({
      remaining:
        sql<string>`coalesce(sum(${stockCostLayers.quantityRemaining}), 0)::numeric(18,3)`,
    })
    .from(stockCostLayers)
    .where(and(...conditions));
  return row?.remaining ?? "0.000";
}

/** Biaya lapisan terbaru (untuk menilai gain opname); null bila belum ada lapisan. */
async function latestLayerCost(
  tx: Tx,
  productId: string,
  warehouseId: string,
  batchId?: string | null,
): Promise<string | null> {
  const conditions = [
    eq(stockCostLayers.productId, productId),
    eq(stockCostLayers.warehouseId, warehouseId),
    batchId === undefined
      ? undefined
      : batchId === null
        ? isNull(stockCostLayers.batchId)
        : eq(stockCostLayers.batchId, batchId),
  ];
  const [row] = await tx
    .select({ unitCost: stockCostLayers.unitCost })
    .from(stockCostLayers)
    .where(and(...conditions))
    .orderBy(desc(stockCostLayers.movementDate), desc(stockCostLayers.id))
    .limit(1);
  return row?.unitCost ?? null;
}

/** Serial yang sedang in_stock di gudang (opsional per batch) untuk set-diff opname. */
async function listInStockSerials(
  tx: Tx,
  productId: string,
  warehouseId: string,
  batchId?: string | null,
): Promise<{ id: string; serialNo: string }[]> {
  const conditions = [
    eq(stockSerials.productId, productId),
    eq(stockSerials.warehouseId, warehouseId),
    eq(stockSerials.status, "in_stock"),
    batchId == null ? undefined : eq(stockSerials.batchId, batchId),
  ];
  return tx
    .select({ id: stockSerials.id, serialNo: stockSerials.serialNo })
    .from(stockSerials)
    .where(and(...conditions))
    .orderBy(stockSerials.serialNo);
}

/**
 * Posting dokumen draf: validasi ulang bentuk, terbitkan nomor, lalu delegasikan
 * setiap baris ke mesin pergerakan 5C (satu sumber FEFO/FIFO). Batch dilahirkan
 * inline untuk baris masuk; serial didaftarkan/dikeluhkan/dipindahkan sesuai jenis.
 */
export async function postStockDocument(
  actor: AuthContext,
  id: string,
  externalTx?: Tx,
) {
  assertCan(actor, "inventory.documents.manage");

  const run = async (tx: Tx) => {
    const { raw } = await lockDocumentHeader(tx, id);
    if (raw.status !== "draft") {
      throw businessRule("Hanya dokumen berstatus draf yang dapat diposting.");
    }

    const lines = await readLines(tx, id);
    await validateStockDocumentShape(tx, linesToInput(raw, lines));

    const docNo = await nextDocumentNumber(tx, NUMBERING_BY_TYPE[raw.type], {
      date: raw.documentDate,
      branchId: raw.branchId,
    });
    const sourceType = SOURCE_BY_TYPE[raw.type];
    const productsMap = await fetchProductsInfo(tx, lines.map((l) => l.productId));

    for (const [index, line] of lines.entries()) {
      const path = `lines.${index}`;
      const product = productsMap.get(line.productId);
      if (!product) throw businessRule("Produk tidak ditemukan.");
      const serials = lineSerials(line.serialNumbers);

      if (raw.type === "receipt") {
        const wh = needWh(raw.toWarehouseId, "Gudang tujuan");
        const batchId = await resolveInboundBatch(tx, actor, {
          productId: line.productId,
          line,
          product,
          documentDate: raw.documentDate,
          path,
        });
        const mv = await postStockMovement(
          actor,
          buildMovementInput({
            productId: line.productId,
            warehouseId: wh,
            locationId: line.toLocationId,
            direction: "in",
            quantity: line.quantity,
            unitCost: line.unitCost,
            movementDate: raw.documentDate,
            sourceType,
            sourceId: id,
            sourceDocNo: docNo,
            batchId,
            memo: line.memo,
          }),
          tx,
        );
        if (usesSerial(product.tracking)) {
          await registerSerials(tx, actor, {
            productId: line.productId,
            batchId: batchId ?? null,
            warehouseId: wh,
            movementId: mv.id,
            serials,
            path,
          });
        }
      } else if (raw.type === "issue") {
        const wh = needWh(raw.fromWarehouseId, "Gudang asal");
        const batchId = usesBatch(product.tracking)
          ? await resolveOutboundBatch(tx, line.productId, line, path)
          : null;
        const mv = await postStockMovement(
          actor,
          buildMovementInput({
            productId: line.productId,
            warehouseId: wh,
            locationId: line.fromLocationId,
            direction: "out",
            quantity: line.quantity,
            movementDate: raw.documentDate,
            sourceType,
            sourceId: id,
            sourceDocNo: docNo,
            batchId,
            memo: line.memo,
          }),
          tx,
        );
        if (usesSerial(product.tracking)) {
          await markSerialsIssued(tx, actor, {
            productId: line.productId,
            warehouseId: wh,
            batchId: batchId ?? null,
            movementId: mv.id,
            serials,
            path,
          });
        }
      } else if (raw.type === "transfer") {
        const fromWh = needWh(raw.fromWarehouseId, "Gudang asal");
        const toWh = needWh(raw.toWarehouseId, "Gudang tujuan");
        const batchId = usesBatch(product.tracking)
          ? await resolveOutboundBatch(tx, line.productId, line, path)
          : null;
        const outMv = await postStockMovement(
          actor,
          buildMovementInput({
            productId: line.productId,
            warehouseId: fromWh,
            locationId: line.fromLocationId,
            direction: "out",
            quantity: line.quantity,
            movementDate: raw.documentDate,
            sourceType,
            sourceId: id,
            sourceDocNo: docNo,
            batchId,
            memo: line.memo,
          }),
          tx,
        );
        const inMv = await postStockMovement(
          actor,
          buildMovementInput({
            productId: line.productId,
            warehouseId: toWh,
            locationId: line.toLocationId,
            direction: "in",
            quantity: line.quantity,
            unitCost: outMv.unitCost,
            movementDate: raw.documentDate,
            sourceType,
            sourceId: id,
            sourceDocNo: docNo,
            batchId: outMv.batchId,
            memo: line.memo,
          }),
          tx,
        );
        if (usesSerial(product.tracking)) {
          await moveSerialsTo(tx, actor, {
            productId: line.productId,
            fromWarehouseId: fromWh,
            toWarehouseId: toWh,
            batchId: batchId ?? null,
            movementId: inMv.id,
            serials,
            path,
          });
        }
      } else if (raw.type === "adjustment") {
        const wh = needWh(raw.fromWarehouseId, "Gudang kerja");
        const inbound = (line.direction ?? "out") === "in";
        if (inbound) {
          const batchId = await resolveInboundBatch(tx, actor, {
            productId: line.productId,
            line,
            product,
            documentDate: raw.documentDate,
            path,
          });
          const mv = await postStockMovement(
            actor,
            buildMovementInput({
              productId: line.productId,
              warehouseId: wh,
              locationId: line.fromLocationId,
              direction: "in",
              quantity: line.quantity,
              unitCost: line.unitCost,
              movementDate: raw.documentDate,
              sourceType,
              sourceId: id,
              sourceDocNo: docNo,
              batchId,
              memo: line.memo,
            }),
            tx,
          );
          if (usesSerial(product.tracking)) {
            await registerSerials(tx, actor, {
              productId: line.productId,
              batchId: batchId ?? null,
              warehouseId: wh,
              movementId: mv.id,
              serials,
              path,
            });
          }
        } else {
          const batchId = usesBatch(product.tracking)
            ? await resolveOutboundBatch(tx, line.productId, line, path)
            : null;
          const mv = await postStockMovement(
            actor,
            buildMovementInput({
              productId: line.productId,
              warehouseId: wh,
              locationId: line.fromLocationId,
              direction: "out",
              quantity: line.quantity,
              movementDate: raw.documentDate,
              sourceType,
              sourceId: id,
              sourceDocNo: docNo,
              batchId,
              memo: line.memo,
            }),
            tx,
          );
          if (usesSerial(product.tracking)) {
            await markSerialsIssued(tx, actor, {
              productId: line.productId,
              warehouseId: wh,
              batchId: batchId ?? null,
              movementId: mv.id,
              serials,
              path,
            });
          }
        }
      } else {
        // opname: selisih vs posisi berjalan (lapisan/serial), dinilai mesin.
        const wh = needWh(raw.fromWarehouseId, "Gudang kerja");
        const batchId = usesBatch(product.tracking)
          ? await resolveOutboundBatch(tx, line.productId, line, path)
          : null;
        const costBatch = usesBatch(product.tracking) ? batchId : undefined;

        if (usesSerial(product.tracking)) {
          const countedSet = new Set(serials);
          const existing = await lockSerials(tx, serials);
          const byNo = new Map(existing.map((s) => [s.serialNo, s]));
          for (const s of existing) {
            if (s.productId !== line.productId) {
              throw businessRule(`Serial ${s.serialNo} bukan milik produk ini.`);
            }
            if (
              s.status !== "in_stock" ||
              s.warehouseId !== wh ||
              (batchId != null && s.batchId !== batchId)
            ) {
              throw businessRule(`Serial ${s.serialNo} tidak dalam posisi tersedia di gudang ini.`);
            }
          }
          const gains = serials.filter((s) => !byNo.has(s));
          const current = await listInStockSerials(tx, line.productId, wh, costBatch);
          const losses = current.filter((c) => !countedSet.has(c.serialNo));

          if (losses.length > 0) {
            const mv = await postStockMovement(
              actor,
              buildMovementInput({
                productId: line.productId,
                warehouseId: wh,
                locationId: line.fromLocationId,
                direction: "out",
                quantity: toDb(String(losses.length), QTY_DP),
                movementDate: raw.documentDate,
                sourceType,
                sourceId: id,
                sourceDocNo: docNo,
                batchId,
                memo: line.memo,
              }),
              tx,
            );
            await markSerialsIssued(tx, actor, {
              productId: line.productId,
              warehouseId: wh,
              batchId: batchId ?? null,
              movementId: mv.id,
              serials: losses.map((l) => l.serialNo),
              path,
            });
          }
          if (gains.length > 0) {
            const unitCost = (await latestLayerCost(tx, line.productId, wh, costBatch)) ?? "0";
            const mv = await postStockMovement(
              actor,
              buildMovementInput({
                productId: line.productId,
                warehouseId: wh,
                locationId: line.fromLocationId,
                direction: "in",
                quantity: toDb(String(gains.length), QTY_DP),
                unitCost,
                movementDate: raw.documentDate,
                sourceType,
                sourceId: id,
                sourceDocNo: docNo,
                batchId,
                memo: line.memo,
              }),
              tx,
            );
            await registerSerials(tx, actor, {
              productId: line.productId,
              batchId: batchId ?? null,
              warehouseId: wh,
              movementId: mv.id,
              serials: gains,
              path,
            });
          }
        } else {
          const expected = await expectedRemaining(tx, line.productId, wh, costBatch);
          const diff = sub(line.quantity, expected);
          if (cmp(diff, 0) > 0) {
            const unitCost = (await latestLayerCost(tx, line.productId, wh, costBatch)) ?? "0";
            await postStockMovement(
              actor,
              buildMovementInput({
                productId: line.productId,
                warehouseId: wh,
                locationId: line.fromLocationId,
                direction: "in",
                quantity: toDb(diff, QTY_DP),
                unitCost,
                movementDate: raw.documentDate,
                sourceType,
                sourceId: id,
                sourceDocNo: docNo,
                batchId,
                memo: line.memo,
              }),
              tx,
            );
          } else if (cmp(diff, 0) < 0) {
            await postStockMovement(
              actor,
              buildMovementInput({
                productId: line.productId,
                warehouseId: wh,
                locationId: line.fromLocationId,
                direction: "out",
                quantity: toDb(sub(expected, line.quantity), QTY_DP),
                movementDate: raw.documentDate,
                sourceType,
                sourceId: id,
                sourceDocNo: docNo,
                batchId,
                memo: line.memo,
              }),
              tx,
            );
          }
        }
      }
    }

    await tx
      .update(stockDocuments)
      .set({ status: "posted", docNo, updatedAt: new Date(), updatedBy: actor.userId })
      .where(eq(stockDocuments.id, id));

    await audit.log(
      {
        action: "stock_document.post",
        entityType: "stock_document",
        entityId: id,
        actorId: actor.userId,
        after: { type: raw.type, docNo, lineCount: lines.length },
      },
      tx,
    );

    return requireStockDocument(tx, id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

/* ============================== Cancel ============================== */

/** Batalkan dokumen draf (belum ada pergerakan, jadi cukup transisi status). */
export async function cancelStockDocument(
  actor: AuthContext,
  id: string,
  input: CancelStockDocumentInput,
  externalTx?: Tx,
) {
  assertCan(actor, "inventory.documents.manage");
  const parsed = cancelStockDocumentSchema.parse(input);

  const run = async (tx: Tx) => {
    const { raw } = await lockDocumentHeader(tx, id);
    if (raw.status !== "draft") {
      throw businessRule("Hanya dokumen berstatus draf yang dapat dibatalkan.");
    }

    await tx
      .update(stockDocuments)
      .set({ status: "cancelled", reason: parsed.reason, updatedAt: new Date(), updatedBy: actor.userId })
      .where(eq(stockDocuments.id, id));

    await audit.log(
      {
        action: "stock_document.cancel",
        entityType: "stock_document",
        entityId: id,
        actorId: actor.userId,
        after: { reason: parsed.reason },
      },
      tx,
    );

    return requireStockDocument(tx, id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

/* ============================== Reverse ============================== */

/**
 * Balik dokumen posted: setiap pergerakan asal dibuat penyeimbangnya
 * (reverseOfId menunjuk gerak asal) — ledger tetap append-only. Batch ikut
 * diteruskan supaya konsumsi/restitusi tepat batch; reversal dibebaskan mesin
 * dari aturan expiry. Serial dikembalikan lewat kepemilikan pergerakan asal.
 */
export async function reverseStockDocument(
  actor: AuthContext,
  id: string,
  input: ReverseStockDocumentInput,
  externalTx?: Tx,
) {
  assertCan(actor, "inventory.documents.manage");
  const parsed = reverseStockDocumentSchema.parse(input);

  const run = async (tx: Tx) => {
    const { raw } = await lockDocumentHeader(tx, id);
    if (raw.status !== "posted") {
      throw businessRule("Hanya dokumen berstatus posted yang dapat dibalik.");
    }
    const docNo = raw.docNo;
    if (!docNo) throw businessRule("Dokumen posted tanpa nomor; tidak dapat dibalik.");

    const movementDate = parsed.documentDate ?? raw.documentDate;
    const sourceType = SOURCE_BY_TYPE[raw.type];

    const originals = await tx
      .select({
        id: stockMovements.id,
        productId: stockMovements.productId,
        warehouseId: stockMovements.warehouseId,
        locationId: stockMovements.locationId,
        direction: stockMovements.direction,
        quantity: stockMovements.quantity,
        unitCost: stockMovements.unitCost,
        batchId: stockMovements.batchId,
      })
      .from(stockMovements)
      .where(and(eq(stockMovements.sourceId, id), isNull(stockMovements.reverseOfId)))
      .orderBy(stockMovements.id);

    if (originals.length === 0) {
      throw businessRule("Tidak ada pergerakan untuk dibalik.");
    }

    const productsMap = await fetchProductsInfo(tx, originals.map((m) => m.productId));

    for (const m of originals) {
      const product = productsMap.get(m.productId);
      const isSerial = product ? usesSerial(product.tracking) : false;

      if (m.direction === "in") {
        const rev = await postStockMovement(
          actor,
          buildMovementInput({
            productId: m.productId,
            warehouseId: m.warehouseId,
            locationId: m.locationId,
            direction: "out",
            quantity: m.quantity,
            movementDate,
            sourceType,
            sourceId: id,
            sourceDocNo: docNo,
            reverseOfId: m.id,
            batchId: m.batchId,
            memo: parsed.reason,
          }),
          tx,
        );
        if (isSerial) {
          const owned = await tx
            .select({ serialNo: stockSerials.serialNo })
            .from(stockSerials)
            .where(
              and(
                eq(stockSerials.movementId, m.id),
                eq(stockSerials.status, "in_stock"),
              ),
            );
          if (owned.length > 0) {
            await markSerialsIssued(tx, actor, {
              productId: m.productId,
              warehouseId: m.warehouseId,
              batchId: m.batchId ?? null,
              movementId: rev.id,
              serials: owned.map((o) => o.serialNo),
              path: "reversal",
            });
          }
        }
      } else {
        const rev = await postStockMovement(
          actor,
          buildMovementInput({
            productId: m.productId,
            warehouseId: m.warehouseId,
            locationId: m.locationId,
            direction: "in",
            quantity: m.quantity,
            unitCost: m.unitCost,
            movementDate,
            sourceType,
            sourceId: id,
            sourceDocNo: docNo,
            reverseOfId: m.id,
            batchId: m.batchId,
            memo: parsed.reason,
          }),
          tx,
        );
        if (isSerial) {
          const owned = await tx
            .select({ id: stockSerials.id })
            .from(stockSerials)
            .where(
              and(
                eq(stockSerials.movementId, m.id),
                eq(stockSerials.status, "issued"),
              ),
            );
          await markSerialsInStock(tx, actor, owned.map((o) => o.id), {
            warehouseId: m.warehouseId,
            movementId: rev.id,
          });
        }
      }
    }

    await tx
      .update(stockDocuments)
      .set({ status: "reversed", reason: parsed.reason, updatedAt: new Date(), updatedBy: actor.userId })
      .where(eq(stockDocuments.id, id));

    await audit.log(
      {
        action: "stock_document.reverse",
        entityType: "stock_document",
        entityId: id,
        actorId: actor.userId,
        after: { docNo, reversed: parsed.reason, movementCount: originals.length },
      },
      tx,
    );

    return requireStockDocument(tx, id);
  };

  return externalTx ? run(externalTx) : db.transaction(run);
}

/* ============================== Baca ============================== */

export async function listStockDocuments(
  actor: AuthContext,
  query: ListStockDocumentsQuery = {},
  externalTx?: Tx,
) {
  assertCan(actor, "inventory.documents.read");
  const parsed = listStockDocumentsQuerySchema.parse(query);
  const reader = externalTx ?? db;

  const conditions = [
    parsed.type === undefined ? undefined : eq(stockDocuments.type, parsed.type),
    parsed.status === undefined ? undefined : eq(stockDocuments.status, parsed.status),
    parsed.branchId === undefined ? undefined : eq(stockDocuments.branchId, parsed.branchId),
    parsed.fromWarehouseId === undefined
      ? undefined
      : eq(stockDocuments.fromWarehouseId, parsed.fromWarehouseId),
    parsed.toWarehouseId === undefined
      ? undefined
      : eq(stockDocuments.toWarehouseId, parsed.toWarehouseId),
  ];

  return documentQuery(reader)
    .where(and(...conditions))
    .orderBy(desc(stockDocuments.documentDate), desc(stockDocuments.id));
}

export async function getStockDocument(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "inventory.documents.read");
  return requireStockDocument(externalTx ?? db, id);
}
