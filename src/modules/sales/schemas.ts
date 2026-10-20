import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Helper                                                              */
/* ------------------------------------------------------------------ */

const idSchema = z.uuid("Format ID tidak valid.");
const dateSchema = z.iso.date("Tanggal harus berformat YYYY-MM-DD.");
const moneySchema = z.string().trim().regex(/^\d{1,14}(\.\d{1,4})?$/, "Nominal tidak valid.");
const qtySchema = z.string().trim().regex(/^\d{1,14}(\.\d{1,3})?$/, "Kuantitas tidak valid.");
const currencySchema = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Kode mata uang harus 3 huruf.");

/* ------------------------ Query Schemas ---------------------------- */

export const listSalesQuerySchema = z.strictObject({
  status: z.enum(["draft", "pending_approval", "approved", "posted", "cancelled", "reversed", "sent", "accepted", "rejected", "expired"]).optional(),
  customerId: idSchema.optional(),
  branchId: idSchema.optional(),
});

/* -------------------------- Quotation ----------------------------- */

export const createQuotationLineSchema = z.strictObject({
  productId: idSchema,
  description: z.string().trim().max(500).optional(),
  quantity: qtySchema,
  unitPrice: moneySchema,
});

export const createQuotationSchema = z.strictObject({
  customerId: idSchema,
  branchId: idSchema,
  quotationDate: dateSchema,
  validUntil: dateSchema.optional(),
  currency: currencySchema.optional(),
  description: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(createQuotationLineSchema).min(1).max(200),
});

export const updateQuotationSchema = z.strictObject({
  customerId: idSchema.optional(),
  branchId: idSchema.optional(),
  quotationDate: dateSchema.optional(),
  validUntil: dateSchema.optional(),
  currency: currencySchema.optional(),
  description: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(createQuotationLineSchema).min(1).max(200),
});

/* --------------------------- Sales Order -------------------------- */

export const createSoLineSchema = z.strictObject({
  productId: idSchema,
  description: z.string().trim().max(500).optional(),
  quantity: qtySchema,
  unitPrice: moneySchema,
});

export const createSalesOrderSchema = z.strictObject({
  customerId: idSchema,
  branchId: idSchema,
  quotationId: idSchema.optional(),
  orderDate: dateSchema,
  expectedDate: dateSchema.optional(),
  currency: currencySchema.optional(),
  description: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(createSoLineSchema).min(1).max(200),
});

export const updateSalesOrderSchema = z.strictObject({
  customerId: idSchema.optional(),
  branchId: idSchema.optional(),
  orderDate: dateSchema.optional(),
  expectedDate: dateSchema.optional(),
  currency: currencySchema.optional(),
  description: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(createSoLineSchema).min(1).max(200),
});

export const cancelDocSchema = z.strictObject({
  reason: z.string().trim().min(3, "Alasan minimal 3 karakter.").max(500),
});

/** Body posting faktur: opsional taxId (master PPN) untuk menghitung & mencatat PPN output. */
export const postInvoiceSchema = z.strictObject({
  taxId: z.uuid("Format taxId tidak valid.").optional(),
});

/* --------------------------- Delivery ----------------------------- */

export const createDeliveryLineSchema = z.strictObject({
  soLineId: idSchema,
  productId: idSchema,
  quantity: qtySchema,
});

export const createDeliverySchema = z.strictObject({
  soId: idSchema,
  branchId: idSchema,
  warehouseId: idSchema,
  deliveryDate: dateSchema,
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(createDeliveryLineSchema).min(1).max(200),
});

/* --------------------------- Sales Return ------------------------- */

export const createReturnLineSchema = z.strictObject({
  deliveryLineId: idSchema,
  productId: idSchema,
  quantity: qtySchema,
});

export const createSalesReturnSchema = z.strictObject({
  deliveryId: idSchema,
  branchId: idSchema,
  warehouseId: idSchema,
  returnDate: dateSchema,
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(createReturnLineSchema).min(1).max(200),
});

/* ------------------------- Customer Invoice ----------------------- */

export const createInvoiceLineSchema = z.strictObject({
  deliveryLineId: idSchema,
  productId: idSchema.optional(),
  description: z.string().trim().max(500).optional(),
  quantity: qtySchema,
  unitPrice: moneySchema,
});

export const createCustomerInvoiceSchema = z.strictObject({
  deliveryId: idSchema,
  branchId: idSchema,
  invoiceDate: dateSchema,
  dueDate: dateSchema,
  currency: currencySchema.optional(),
  /** Pajak master (mis. PPN). Bila diisi, faktur menghitung PPN output dari tarif
   *  berlaku pada invoiceDate dan mencatat transaksi pajak saat posting. */
  taxId: idSchema.optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(createInvoiceLineSchema).min(1).max(200),
});

/* ------------------------ Customer Payment ------------------------ */

/**
 * Pembayaran customer. Alokasi ke invoice terbuka dihitung otomatis (FIFO,
 * urut jatuh tempo) saat posting — tidak dikirim dari klien.
 */
export const createCustomerPaymentSchema = z.strictObject({
  customerId: idSchema,
  branchId: idSchema,
  paymentDate: dateSchema,
  bankAccountId: idSchema,
  currency: currencySchema.optional(),
  amountForeign: moneySchema,
  memo: z.string().trim().max(2000).optional(),
});

/* --------------------------- Credit Note -------------------------- */

export const createCreditNoteLineSchema = z.strictObject({
  invoiceLineId: idSchema.optional(),
  productId: idSchema.optional(),
  description: z.string().trim().max(500).optional(),
  quantity: qtySchema,
  unitPrice: moneySchema,
});

export const createCreditNoteSchema = z.strictObject({
  invoiceId: idSchema,
  branchId: idSchema,
  creditNoteDate: dateSchema,
  currency: currencySchema.optional(),
  reason: z.string().trim().min(3).max(500),
  lines: z.array(createCreditNoteLineSchema).min(1).max(200),
});

/* ------------------------------- Tipe ----------------------------- */

export type ListSalesQuery = z.output<typeof listSalesQuerySchema>;
export type CreateQuotationInput = z.output<typeof createQuotationSchema>;
export type UpdateQuotationInput = z.output<typeof updateQuotationSchema>;
export type CreateSalesOrderInput = z.output<typeof createSalesOrderSchema>;
export type UpdateSalesOrderInput = z.output<typeof updateSalesOrderSchema>;
export type CancelDocInput = z.output<typeof cancelDocSchema>;
export type CreateDeliveryInput = z.output<typeof createDeliverySchema>;
export type CreateSalesReturnInput = z.output<typeof createSalesReturnSchema>;
export type CreateCustomerInvoiceInput = z.output<typeof createCustomerInvoiceSchema>;
export type CreateCustomerPaymentInput = z.output<typeof createCustomerPaymentSchema>;
export type CreateCreditNoteInput = z.output<typeof createCreditNoteSchema>;
