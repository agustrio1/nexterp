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

/** Kode mata uang: 3 huruf kapital. */
const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Kode mata uang harus 3 huruf.");

/** Kuantitas: string desimal > 0, maksimal 15 digit + 3 desimal. */
const quantitySchema = z
  .string()
  .trim()
  .regex(/^\d{1,15}(\.\d{1,3})?$/, "Kuantitas maksimal 15 digit dan 3 desimal.")
  .refine((value) => /[1-9]/.test(value.replace(".", "")), "Kuantitas harus lebih dari nol.");

/** Harga satuan: non-negatif, maksimal 14 digit + 4 desimal (sesuai numeric(18,4)). */
const unitPriceSchema = z
  .string()
  .trim()
  .regex(/^\d{1,14}(\.\d{1,4})?$/, "Harga satuan maksimal 14 digit dan 4 desimal.");

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

const reasonSchema = z.string().trim().min(5, "Alasan minimal 5 karakter.").max(500);

/* ------------------------------------------------------------------ */
/* Termin pembayaran                                                   */
/* ------------------------------------------------------------------ */

export const createPaymentTermSchema = z.strictObject({
  code: masterCode("termin"),
  name: masterName("termin"),
  dueInDays: z.coerce.number().int().min(1).max(3650),
  description: optionalText(500, "Deskripsi"),
});

export const updatePaymentTermSchema = z
  .strictObject({
    name: masterName("termin").optional(),
    dueInDays: z.coerce.number().int().min(1).max(3650).optional(),
    description: optionalText(500, "Deskripsi"),
    isActive: z.boolean().optional(),
  })
  .refine(hasAnyField, atLeastOneField);

export const listPaymentTermsQuerySchema = z.strictObject({
  isActive: isActiveFlag,
});

/* ------------------------------------------------------------------ */
/* Supplier                                                            */
/* ------------------------------------------------------------------ */

export const createSupplierSchema = z.strictObject({
  code: masterCode("supplier", 30),
  name: masterName("supplier"),
  taxId: optionalText(30, "NPWP"),
  currency: currencyCodeSchema.optional(),
  paymentTermsId: idSchema.nullable().optional(),
  email: optionalText(120, "Email"),
  phone: optionalText(30, "Telepon"),
  address: optionalText(300, "Alamat"),
  notes: optionalText(500, "Catatan"),
});

export const updateSupplierSchema = z
  .strictObject({
    name: masterName("supplier").optional(),
    taxId: optionalText(30, "NPWP"),
    currency: currencyCodeSchema.optional(),
    paymentTermsId: idSchema.nullable().optional(),
    email: optionalText(120, "Email"),
    phone: optionalText(30, "Telepon"),
    address: optionalText(300, "Alamat"),
    notes: optionalText(500, "Catatan"),
    isActive: z.boolean().optional(),
  })
  .refine(hasAnyField, atLeastOneField);

export const listSuppliersQuerySchema = z.strictObject({
  isActive: isActiveFlag,
  search: z.string().trim().min(1).max(100).optional(),
});

/* ------------------------------------------------------------------ */
/* Purchase Order (5F) — header + baris, state machine                 */
/* ------------------------------------------------------------------ */

const purchaseOrderLineSchema = z.strictObject({
  productId: idSchema,
  quantity: quantitySchema,
  unitPrice: unitPriceSchema,
  description: optionalText(200, "Deskripsi"),
});

export const createPurchaseOrderSchema = z.strictObject({
  supplierId: idSchema,
  branchId: idSchema,
  orderDate: z.iso.date(),
  expectedDate: z.iso.date().optional(),
  currency: currencyCodeSchema.optional(),
  description: optionalText(500, "Deskripsi"),
  notes: optionalText(500, "Catatan"),
  lines: z.array(purchaseOrderLineSchema).min(1, "PO harus memiliki minimal satu baris."),
});

export const updatePurchaseOrderSchema = z.strictObject({
  supplierId: idSchema.optional(),
  branchId: idSchema.optional(),
  orderDate: z.iso.date().optional(),
  expectedDate: z.iso.date().nullable().optional(),
  currency: currencyCodeSchema.optional(),
  description: optionalText(500, "Deskripsi"),
  notes: optionalText(500, "Catatan"),
  lines: z.array(purchaseOrderLineSchema).min(1, "PO harus memiliki minimal satu baris."),
});

export const cancelPurchaseOrderSchema = z.strictObject({ reason: reasonSchema });

export const listPurchaseOrdersQuerySchema = z.strictObject({
  status: z.enum(["draft", "pending_approval", "approved", "posted", "cancelled"]).optional(),
  supplierId: idSchema.optional(),
  branchId: idSchema.optional(),
});

/* ------------------------------------------------------------------ */
/* Penerimaan barang dari PO (5F)                                      */
/* ------------------------------------------------------------------ */

const receiptLineSchema = z.strictObject({
  poLineId: idSchema,
  quantity: quantitySchema,
  batchNo: batchNoSchema.optional(),
  batchExpiryDate: z.iso.date().optional(),
  serialNumbers: z
    .array(serialNoSchema)
    .max(1000, "Maksimal 1000 nomor serial per baris.")
    .optional(),
});

export const createReceiptFromPoSchema = z.strictObject({
  warehouseId: idSchema,
  documentDate: z.iso.date(),
  description: optionalText(500, "Deskripsi"),
  lines: z.array(receiptLineSchema).min(1, "Penerimaan harus memiliki minimal satu baris."),
});

/* ------------------------------------------------------------------ */
/* Invoice pemasok (5G) — three-way match ke PO + penerimaan          */
/* ------------------------------------------------------------------ */

const supplierInvoiceLineSchema = z.strictObject({
  poLineId: idSchema,
  quantity: quantitySchema,
  unitPrice: unitPriceSchema,
  description: optionalText(200, "Deskripsi"),
});

export const createSupplierInvoiceSchema = z.strictObject({
  poId: idSchema,
  invoiceDate: z.iso.date(),
  dueDate: z.iso.date(),
  notes: optionalText(500, "Catatan"),
  lines: z
    .array(supplierInvoiceLineSchema)
    .min(1, "Invoice harus memiliki minimal satu baris."),
});

export const updateSupplierInvoiceSchema = z.strictObject({
  invoiceDate: z.iso.date().optional(),
  dueDate: z.iso.date().optional(),
  notes: optionalText(500, "Catatan"),
  lines: z
    .array(supplierInvoiceLineSchema)
    .min(1, "Invoice harus memiliki minimal satu baris."),
});

export const listSupplierInvoicesQuerySchema = z.strictObject({
  status: z.enum(["draft", "posted", "cancelled", "reversed"]).optional(),
  supplierId: idSchema.optional(),
  poId: idSchema.optional(),
});

/* ------------------------------------------------------------------ */
/* Pembayaran AP (5G) — alokasi FIFO ke invoice terbuka               */
/* ------------------------------------------------------------------ */

export const createApPaymentSchema = z.strictObject({
  supplierId: idSchema,
  branchId: idSchema,
  paymentDate: z.iso.date(),
  currency: currencyCodeSchema.optional(),
  amountForeign: unitPriceSchema, // string desimal >= 0; divalidasi > 0 via money di service
  bankAccountId: idSchema,
  memo: optionalText(500, "Memo"),
});

export const listApPaymentsQuerySchema = z.strictObject({
  status: z.enum(["draft", "posted", "cancelled", "reversed"]).optional(),
  supplierId: idSchema.optional(),
});

/** Body beralasan untuk pembatalan/reversal dokumen AP (invoice & pembayaran). */
export const apReasonSchema = z.strictObject({ reason: reasonSchema });

/* ------------------------------------------------------------------ */
/* Tipe                                                                */
/* ------------------------------------------------------------------ */

export type CreatePaymentTermInput = z.output<typeof createPaymentTermSchema>;
export type UpdatePaymentTermInput = z.output<typeof updatePaymentTermSchema>;
export type ListPaymentTermsQuery = z.output<typeof listPaymentTermsQuerySchema>;

export type CreateSupplierInput = z.output<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.output<typeof updateSupplierSchema>;
export type ListSuppliersQuery = z.output<typeof listSuppliersQuerySchema>;

export type CreatePurchaseOrderInput = z.output<typeof createPurchaseOrderSchema>;
export type UpdatePurchaseOrderInput = z.output<typeof updatePurchaseOrderSchema>;
export type CancelPurchaseOrderInput = z.output<typeof cancelPurchaseOrderSchema>;
export type ListPurchaseOrdersQuery = z.output<typeof listPurchaseOrdersQuerySchema>;

export type CreateReceiptFromPoInput = z.output<typeof createReceiptFromPoSchema>;

export type CreateSupplierInvoiceInput = z.output<typeof createSupplierInvoiceSchema>;
export type UpdateSupplierInvoiceInput = z.output<typeof updateSupplierInvoiceSchema>;
export type ListSupplierInvoicesQuery = z.output<typeof listSupplierInvoicesQuerySchema>;

export type CreateApPaymentInput = z.output<typeof createApPaymentSchema>;
export type ListApPaymentsQuery = z.output<typeof listApPaymentsQuerySchema>;
export type ApReasonInput = z.output<typeof apReasonSchema>;
