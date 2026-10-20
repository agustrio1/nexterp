import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Helper                                                              */
/* ------------------------------------------------------------------ */

const emptyToNull = (value: string) => (value === "" ? null : value);

function optionalText(max: number, label: string) {
  return z
    .string()
    .trim()
    .max(max, `${label} maksimal ${max} karakter.`)
    .transform(emptyToNull)
    .nullable()
    .optional();
}

const hasAnyField = (value: Record<string, unknown>) =>
  Object.values(value).some((field) => field !== undefined);
const atLeastOneField = { message: "Minimal satu field harus diisi." };

const idSchema = z.uuid("Format ID tidak valid.");
const isActiveFlag = z
  .enum(["true", "false"])
  .transform((value) => value === "true")
  .optional();

function masterCode(label: string, max = 30) {
  return z
    .string()
    .trim()
    .toUpperCase()
    .min(2, `Kode ${label} minimal 2 karakter.`)
    .max(max, `Kode ${label} maksimal ${max} karakter.`)
    .regex(
      /^[A-Z0-9][A-Z0-9._-]*$/,
      `Kode ${label} hanya boleh huruf, angka, titik, strip, underscore, diawali huruf atau angka.`,
    );
}

function masterName(label: string) {
  return z
    .string()
    .trim()
    .min(2, `Nama ${label} minimal 2 karakter.`)
    .max(150, `Nama ${label} maksimal 150 karakter.`);
}

/** Rasio konversi: string desimal > 0, maksimal 12 digit bulat + 6 desimal. */
const ratioSchema = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,6})?$/, "Rasio maksimal 12 digit bulat dan 6 desimal.")
  .refine((value) => /[1-9]/.test(value.replace(".", "")), "Rasio harus lebih dari nol.");

/**
 * Reorder point (titik pemesanan kembali): string desimal >= 0, maks 12 digit
 * bulat + 3 desimal (skala kuantitas). Kosong (`""`) → null (produk tak dipantau).
 */
const reorderPointSchema = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,3})?$/, "Reorder point maksimal 12 digit bulat dan 3 desimal.")
  .transform(emptyToNull)
  .nullable()
  .optional();

/* ------------------------------------------------------------------ */
/* Kategori produk                                                     */
/* ------------------------------------------------------------------ */

export const createProductCategorySchema = z.strictObject({
  code: masterCode("kategori"),
  name: masterName("kategori"),
  parentId: idSchema.nullable().optional(),
  description: optionalText(500, "Deskripsi"),
});

export const updateProductCategorySchema = z
  .strictObject({
    name: masterName("kategori").optional(),
    parentId: idSchema.nullable().optional(),
    description: optionalText(500, "Deskripsi"),
    isActive: z.boolean().optional(),
  })
  .refine(hasAnyField, atLeastOneField);

export const listProductCategoriesQuerySchema = z.strictObject({
  isActive: isActiveFlag,
  parentId: idSchema.optional(),
});

/* ------------------------------------------------------------------ */
/* Satuan (unit of measure)                                            */
/* ------------------------------------------------------------------ */

export const createUnitSchema = z.strictObject({
  code: masterCode("satuan"),
  name: masterName("satuan"),
  symbol: optionalText(10, "Simbol"),
});

export const updateUnitSchema = z
  .strictObject({
    name: masterName("satuan").optional(),
    symbol: optionalText(10, "Simbol"),
    isActive: z.boolean().optional(),
  })
  .refine(hasAnyField, atLeastOneField);

export const listUnitsQuerySchema = z.strictObject({
  isActive: isActiveFlag,
});

/* ------------------------------------------------------------------ */
/* Konversi satuan                                                     */
/* ------------------------------------------------------------------ */

export const createUnitConversionSchema = z
  .strictObject({
    fromUnitId: idSchema,
    toUnitId: idSchema,
    ratio: ratioSchema,
    note: optionalText(200, "Catatan"),
  })
  .refine((value) => value.fromUnitId !== value.toUnitId, {
    path: ["toUnitId"],
    message: "Satuan asal dan tujuan tidak boleh sama.",
  });

export const updateUnitConversionSchema = z
  .strictObject({
    ratio: ratioSchema.optional(),
    note: optionalText(200, "Catatan"),
  })
  .refine(hasAnyField, atLeastOneField);

export const listUnitConversionsQuerySchema = z.strictObject({
  fromUnitId: idSchema.optional(),
  toUnitId: idSchema.optional(),
});

/* ------------------------------------------------------------------ */
/* Produk                                                              */
/* ------------------------------------------------------------------ */

export const productTrackingValues = ["none", "batch", "serial", "both"] as const;

const batchNoSchema = z
  .string()
  .trim()
  .min(1, "Nomor batch wajib diisi.")
  .max(50, "Nomor batch maksimal 50 karakter.");

const serialNoSchema = z
  .string()
  .trim()
  .min(1, "Nomor serial wajib diisi.")
  .max(100, "Nomor serial maksimal 100 karakter.");

export const createProductSchema = z.strictObject({
  sku: masterCode("SKU", 50),
  name: masterName("produk"),
  categoryId: idSchema.nullable().optional(),
  baseUnitId: idSchema,
  canPurchase: z.boolean().optional(),
  canSell: z.boolean().optional(),
  tracking: z.enum(productTrackingValues).optional(),
  needsExpiry: z.boolean().optional(),
  reorderPoint: reorderPointSchema,
  description: optionalText(500, "Deskripsi"),
});

export const updateProductSchema = z
  .strictObject({
    name: masterName("produk").optional(),
    categoryId: idSchema.nullable().optional(),
    baseUnitId: idSchema.optional(),
    canPurchase: z.boolean().optional(),
    canSell: z.boolean().optional(),
    tracking: z.enum(productTrackingValues).optional(),
    needsExpiry: z.boolean().optional(),
    isActive: z.boolean().optional(),
    reorderPoint: reorderPointSchema,
    description: optionalText(500, "Deskripsi"),
  })
  .refine(hasAnyField, atLeastOneField);

export const listProductsQuerySchema = z.strictObject({
  isActive: isActiveFlag,
  categoryId: idSchema.optional(),
  baseUnitId: idSchema.optional(),
  search: z.string().trim().min(1).max(100).optional(),
});

/* ------------------------------------------------------------------ */
/* Gudang (warehouse)                                                  */
/* ------------------------------------------------------------------ */

export const createWarehouseSchema = z.strictObject({
  code: masterCode("gudang"),
  name: masterName("gudang"),
  branchId: idSchema,
  address: optionalText(200, "Alamat"),
  description: optionalText(500, "Deskripsi"),
});

export const updateWarehouseSchema = z
  .strictObject({
    name: masterName("gudang").optional(),
    branchId: idSchema.optional(),
    address: optionalText(200, "Alamat"),
    description: optionalText(500, "Deskripsi"),
    isActive: z.boolean().optional(),
  })
  .refine(hasAnyField, atLeastOneField);

export const listWarehousesQuerySchema = z.strictObject({
  isActive: isActiveFlag,
  branchId: idSchema.optional(),
});

/* ------------------------------------------------------------------ */
/* Lokasi gudang (warehouse location)                                 */
/* ------------------------------------------------------------------ */

export const createWarehouseLocationSchema = z.strictObject({
  warehouseId: idSchema,
  code: masterCode("lokasi", 20),
  name: masterName("lokasi"),
  description: optionalText(500, "Deskripsi"),
});

export const updateWarehouseLocationSchema = z
  .strictObject({
    name: masterName("lokasi").optional(),
    description: optionalText(500, "Deskripsi"),
    isActive: z.boolean().optional(),
  })
  .refine(hasAnyField, atLeastOneField);

export const listWarehouseLocationsQuerySchema = z.strictObject({
  warehouseId: idSchema.optional(),
  isActive: isActiveFlag,
});

/* ------------------------------------------------------------------ */
/* Pergerakan stok (5C — dipakai internal oleh service & dokumen 5D)   */
/* ------------------------------------------------------------------ */

const quantitySchema = z
  .string()
  .trim()
  .regex(/^\d{1,15}(\.\d{1,3})?$/, "Kuantitas maksimal 15 digit dan 3 desimal.")
  .refine((value) => /[1-9]/.test(value.replace(".", "")), "Kuantitas harus lebih dari nol.");

const unitCostSchema = z
  .string()
  .trim()
  .regex(/^\d{1,14}(\.\d{1,4})?$/, "Biaya satuan maksimal 14 digit dan 4 desimal.");

export const stockDirectionValues = ["in", "out"] as const;
export const stockSourceValues = [
  "opening",
  "goods_receipt",
  "goods_issue",
  "transfer",
  "adjustment",
] as const;

export const postStockMovementInputSchema = z
  .strictObject({
    productId: idSchema,
    warehouseId: idSchema,
    locationId: idSchema.nullable().optional(),
    direction: z.enum(stockDirectionValues),
    quantity: quantitySchema,
    unitCost: unitCostSchema.nullable().optional(),
    movementDate: z.iso.date(),
    sourceType: z.enum(stockSourceValues),
    sourceId: idSchema.nullable().optional(),
    sourceDocNo: z.string().trim().max(50).optional(),
    reverseOfId: idSchema.nullable().optional(),
    batchId: idSchema.nullable().optional(),
    memo: optionalText(500, "Catatan"),
  })
  .refine((value) => value.direction !== "in" || (value.unitCost ?? null) !== null, {
    path: ["unitCost"],
    message: "Pergerakan masuk wajib menyertakan biaya satuan.",
  });

export const getStockPositionQuerySchema = z.strictObject({
  productId: idSchema.optional(),
  warehouseId: idSchema.optional(),
});

export const listStockMovementsQuerySchema = z.strictObject({
  productId: idSchema.optional(),
  warehouseId: idSchema.optional(),
});

/* ------------------------------------------------------------------ */
/* Dokumen stok (5D) — header + baris, state machine draf->posted      */
/* ------------------------------------------------------------------ */

export const stockDocumentTypeValues = [
  "receipt",
  "issue",
  "transfer",
  "adjustment",
  "opname",
] as const;

/** Qty baris dokumen: >= 0 (opname boleh nol); kaidah per jenis dijaga service. */
const documentLineQuantitySchema = z
  .string()
  .trim()
  .regex(/^\d{1,15}(\.\d{1,3})?$/, "Kuantitas maksimal 15 digit dan 3 desimal.");

const documentLineSchema = z.strictObject({
  productId: idSchema,
  fromLocationId: idSchema.nullable().optional(),
  toLocationId: idSchema.nullable().optional(),
  direction: z.enum(stockDirectionValues).optional(),
  quantity: documentLineQuantitySchema,
  unitCost: unitCostSchema.nullable().optional(),
  batchNo: batchNoSchema.optional(),
  batchExpiryDate: z.iso.date().optional(),
  batchId: idSchema.nullable().optional(),
  serialNumbers: z
    .array(serialNoSchema)
    .max(1000, "Maksimal 1000 nomor serial per baris.")
    .optional(),
  memo: optionalText(500, "Catatan"),
});

export const createStockDocumentSchema = z.strictObject({
  type: z.enum(stockDocumentTypeValues),
  documentDate: z.iso.date(),
  branchId: idSchema,
  fromWarehouseId: idSchema.optional(),
  toWarehouseId: idSchema.optional(),
  description: optionalText(500, "Deskripsi"),
  lines: z.array(documentLineSchema).min(1, "Dokumen harus memiliki minimal satu baris."),
});

const reasonSchema = z.string().trim().min(5, "Alasan minimal 5 karakter.").max(500);

export const cancelStockDocumentSchema = z.strictObject({ reason: reasonSchema });

export const reverseStockDocumentSchema = z.strictObject({
  reason: reasonSchema,
  documentDate: z.iso.date().optional(),
});

export const listStockDocumentsQuerySchema = z.strictObject({
  type: z.enum(stockDocumentTypeValues).optional(),
  status: z.enum(["draft", "posted", "reversed", "cancelled"]).optional(),
  branchId: idSchema.optional(),
  fromWarehouseId: idSchema.optional(),
  toWarehouseId: idSchema.optional(),
});

/* ------------------------------------------------------------------ */
/* Tipe                                                                */
/* ------------------------------------------------------------------ */

export type CreateProductCategoryInput = z.output<typeof createProductCategorySchema>;
export type UpdateProductCategoryInput = z.output<typeof updateProductCategorySchema>;
export type ListProductCategoriesQuery = z.output<typeof listProductCategoriesQuerySchema>;

export type CreateUnitInput = z.output<typeof createUnitSchema>;
export type UpdateUnitInput = z.output<typeof updateUnitSchema>;
export type ListUnitsQuery = z.output<typeof listUnitsQuerySchema>;

export type CreateUnitConversionInput = z.output<typeof createUnitConversionSchema>;
export type UpdateUnitConversionInput = z.output<typeof updateUnitConversionSchema>;
export type ListUnitConversionsQuery = z.output<typeof listUnitConversionsQuerySchema>;

export type CreateProductInput = z.output<typeof createProductSchema>;
export type UpdateProductInput = z.output<typeof updateProductSchema>;
export type ListProductsQuery = z.output<typeof listProductsQuerySchema>;

export type CreateWarehouseInput = z.output<typeof createWarehouseSchema>;
export type UpdateWarehouseInput = z.output<typeof updateWarehouseSchema>;
export type ListWarehousesQuery = z.output<typeof listWarehousesQuerySchema>;

export type CreateWarehouseLocationInput = z.output<typeof createWarehouseLocationSchema>;
export type UpdateWarehouseLocationInput = z.output<typeof updateWarehouseLocationSchema>;
export type ListWarehouseLocationsQuery = z.output<typeof listWarehouseLocationsQuerySchema>;

export type PostStockMovementInput = z.output<typeof postStockMovementInputSchema>;
export type GetStockPositionQuery = z.output<typeof getStockPositionQuerySchema>;
export type ListStockMovementsQuery = z.output<typeof listStockMovementsQuerySchema>;

export type CreateStockDocumentInput = z.output<typeof createStockDocumentSchema>;
export type CancelStockDocumentInput = z.output<typeof cancelStockDocumentSchema>;
export type ReverseStockDocumentInput = z.output<typeof reverseStockDocumentSchema>;
export type ListStockDocumentsQuery = z.output<typeof listStockDocumentsQuerySchema>;
