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
      `Kode ${label} hanya boleh huruf, angka, titik, strip, underscore.`,
    );
}

function masterName(label: string) {
  return z
    .string()
    .trim()
    .min(2, `Nama ${label} minimal 2 karakter.`)
    .max(150, `Nama ${label} maksimal 150 karakter.`);
}

const dateSchema = z.iso.date("Tanggal harus berformat YYYY-MM-DD.");

/* -------------------------- Query umum ---------------------------- */

export const listQuerySchema = z.strictObject({
  isActive: isActiveFlag,
  search: optionalText(100, "Pencarian"),
});

/* ----------------------------- Accounts ---------------------------- */

export const createAccountSchema = z.strictObject({
  code: masterCode("akun"),
  name: masterName("akun"),
  type: z.enum(["prospect", "customer", "partner"]).default("prospect"),
  taxId: optionalText(30, "NPWP"),
  address: optionalText(500, "Alamat"),
  city: optionalText(100, "Kota"),
  province: optionalText(100, "Provinsi"),
  country: optionalText(100, "Negara"),
  phone: optionalText(30, "Telepon"),
  email: z.string().trim().email("Email tidak valid.").transform(emptyToNull).nullable().optional(),
  website: optionalText(200, "Website"),
  notes: optionalText(2000, "Catatan"),
});

export const updateAccountSchema = z.strictObject({
  name: masterName("akun").optional(),
  type: z.enum(["prospect", "customer", "partner"]).optional(),
  taxId: optionalText(30, "NPWP"),
  address: optionalText(500, "Alamat"),
  city: optionalText(100, "Kota"),
  province: optionalText(100, "Provinsi"),
  country: optionalText(100, "Negara"),
  phone: optionalText(30, "Telepon"),
  email: z.string().trim().email("Email tidak valid.").transform(emptyToNull).nullable().optional(),
  website: optionalText(200, "Website"),
  notes: optionalText(2000, "Catatan"),
  isActive: z.boolean().optional(),
});

/* ----------------------------- Contacts ---------------------------- */

export const createContactSchema = z.strictObject({
  accountId: idSchema,
  name: masterName("kontak"),
  title: optionalText(100, "Jabatan"),
  email: z.string().trim().email("Email tidak valid.").transform(emptyToNull).nullable().optional(),
  phone: optionalText(30, "Telepon"),
  isPrimary: z.boolean().default(false),
});

export const updateContactSchema = z.strictObject({
  name: masterName("kontak").optional(),
  title: optionalText(100, "Jabatan"),
  email: z.string().trim().email("Email tidak valid.").transform(emptyToNull).nullable().optional(),
  phone: optionalText(30, "Telepon"),
  isPrimary: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

/* ------------------------------- Leads ----------------------------- */

export const createLeadSchema = z.strictObject({
  name: masterName("lead"),
  source: optionalText(100, "Sumber"),
  contactName: optionalText(150, "Nama kontak"),
  email: z.string().trim().email("Email tidak valid.").transform(emptyToNull).nullable().optional(),
  phone: optionalText(30, "Telepon"),
  company: optionalText(200, "Perusahaan"),
  assignedTo: idSchema.optional(),
  notes: optionalText(2000, "Catatan"),
});

export const updateLeadSchema = z.strictObject({
  name: masterName("lead").optional(),
  source: optionalText(100, "Sumber"),
  status: z.enum(["new", "contacted", "qualified", "discarded"]).optional(),
  contactName: optionalText(150, "Nama kontak"),
  email: z.string().trim().email("Email tidak valid.").transform(emptyToNull).nullable().optional(),
  phone: optionalText(30, "Telepon"),
  company: optionalText(200, "Perusahaan"),
  assignedTo: idSchema.optional(),
  notes: optionalText(2000, "Catatan"),
});

export const convertLeadSchema = z.strictObject({
  accountCode: masterCode("akun"),
  accountName: masterName("akun"),
  contactName: masterName("kontak"),
  contactEmail: z.string().trim().email("Email tidak valid.").transform(emptyToNull).nullable().optional(),
  contactPhone: optionalText(30, "Telepon"),
});

/* ----------------------------- Pipeline ---------------------------- */

export const createStageSchema = z.strictObject({
  name: masterName("tahap"),
  position: z.number().int().min(1),
  probability: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, "Probabilitas 0-100."),
});

export const updateStageSchema = z.strictObject({
  name: masterName("tahap").optional(),
  position: z.number().int().min(1).optional(),
  probability: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, "Probabilitas 0-100.").optional(),
  isActive: z.boolean().optional(),
});

/* --------------------------- Opportunities -------------------------- */

export const createOpportunitySchema = z.strictObject({
  accountId: idSchema,
  leadId: idSchema.optional(),
  title: masterName("peluang"),
  stageId: idSchema,
  amount: z.string().trim().regex(/^\d{1,14}(\.\d{1,2})?$/, "Nominal maksimal 14 digit + 2 desimal.").optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Kode mata uang harus 3 huruf.").optional(),
  expectedCloseDate: dateSchema.optional(),
  assignedTo: idSchema.optional(),
  probability: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, "Probabilitas 0-100.").optional(),
});

export const updateOpportunitySchema = z.strictObject({
  title: masterName("peluang").optional(),
  amount: z.string().trim().regex(/^\d{1,14}(\.\d{1,2})?$/, "Nominal maksimal 14 digit + 2 desimal.").optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Kode mata uang harus 3 huruf.").optional(),
  expectedCloseDate: dateSchema.optional(),
  assignedTo: idSchema.optional(),
  probability: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, "Probabilitas 0-100.").optional(),
  isActive: z.boolean().optional(),
});

export const moveStageSchema = z.strictObject({
  stageId: idSchema,
});

export const closeOpportunitySchema = z.strictObject({
  status: z.enum(["won", "lost"]),
});

/* ---------------------------- Activities ---------------------------- */

export const createActivitySchema = z.strictObject({
  accountId: idSchema.optional(),
  contactId: idSchema.optional(),
  leadId: idSchema.optional(),
  opportunityId: idSchema.optional(),
  type: z.enum(["call", "email", "meeting", "task", "other"]),
  subject: z.string().trim().min(1, "Subjek wajib diisi.").max(300, "Subjek maksimal 300 karakter."),
  description: optionalText(5000, "Deskripsi"),
  assignedTo: idSchema.optional(),
});

/* ------------------------------- Tasks ------------------------------ */

export const createTaskSchema = z.strictObject({
  accountId: idSchema.optional(),
  opportunityId: idSchema.optional(),
  title: z.string().trim().min(1, "Judul wajib diisi.").max(300, "Judul maksimal 300 karakter."),
  description: optionalText(5000, "Deskripsi"),
  dueDate: dateSchema.optional(),
  assignedTo: idSchema.optional(),
});

export const updateTaskSchema = z.strictObject({
  title: z.string().trim().min(1).max(300).optional(),
  description: optionalText(5000, "Deskripsi"),
  dueDate: dateSchema.optional(),
  assignedTo: idSchema.optional(),
  isCompleted: z.boolean().optional(),
});

/* ------------------------------- Notes ------------------------------ */

export const createNoteSchema = z.strictObject({
  accountId: idSchema.optional(),
  contactId: idSchema.optional(),
  opportunityId: idSchema.optional(),
  content: z.string().trim().min(1, "Isi catatan wajib diisi.").max(10000, "Catatan maksimal 10000 karakter."),
});

/* ------------------------------ Segments ---------------------------- */

export const createSegmentSchema = z.strictObject({
  name: masterName("segmen"),
  description: optionalText(1000, "Deskripsi"),
  criteria: z.record(z.string(), z.unknown()).optional(),
});

export const updateSegmentSchema = z.strictObject({
  name: masterName("segmen").optional(),
  description: optionalText(1000, "Deskripsi"),
  criteria: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

export const assignSegmentSchema = z.strictObject({
  accountId: idSchema,
  segmentId: idSchema,
});

/* ----------------------------- Customers ---------------------------- */

export const createCustomerSchema = z.strictObject({
  crmAccountId: idSchema,
  code: masterCode("pelanggan"),
  creditLimit: z.string().trim().regex(/^\d{1,14}(\.\d{1,2})?$/, "Batas kredit maksimal 14 digit + 2 desimal.").optional(),
  paymentTermsId: idSchema.optional(),
  priceListId: idSchema.optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Kode mata uang harus 3 huruf.").default("IDR"),
});

export const updateCustomerSchema = z.strictObject({
  creditLimit: z.string().trim().regex(/^\d{1,14}(\.\d{1,2})?$/, "Batas kredit maksimal 14 digit + 2 desimal.").optional(),
  paymentTermsId: idSchema.optional(),
  priceListId: idSchema.optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Kode mata uang harus 3 huruf.").optional(),
  isActive: z.boolean().optional(),
});

/* ---------------------------- Price Lists --------------------------- */

export const createPriceListSchema = z.strictObject({
  code: masterCode("daftar harga"),
  name: masterName("daftar harga"),
  validFrom: dateSchema,
  validTo: dateSchema.optional(),
});

export const updatePriceListSchema = z.strictObject({
  name: masterName("daftar harga").optional(),
  validFrom: dateSchema.optional(),
  validTo: dateSchema.optional(),
  isActive: z.boolean().optional(),
});

export const addPriceItemSchema = z.strictObject({
  productId: idSchema,
  unitPrice: z.string().trim().regex(/^\d{1,14}(\.\d{1,4})?$/, "Harga maksimal 14 digit + 4 desimal."),
});

/* ------------------------------- Tipe ------------------------------- */

export type ListQuery = z.output<typeof listQuerySchema>;
export type CreateAccountInput = z.output<typeof createAccountSchema>;
export type UpdateAccountInput = z.output<typeof updateAccountSchema>;
export type CreateContactInput = z.output<typeof createContactSchema>;
export type UpdateContactInput = z.output<typeof updateContactSchema>;
export type CreateLeadInput = z.output<typeof createLeadSchema>;
export type UpdateLeadInput = z.output<typeof updateLeadSchema>;
export type ConvertLeadInput = z.output<typeof convertLeadSchema>;
export type CreateStageInput = z.output<typeof createStageSchema>;
export type UpdateStageInput = z.output<typeof updateStageSchema>;
export type CreateOpportunityInput = z.output<typeof createOpportunitySchema>;
export type UpdateOpportunityInput = z.output<typeof updateOpportunitySchema>;
export type MoveStageInput = z.output<typeof moveStageSchema>;
export type CloseOpportunityInput = z.output<typeof closeOpportunitySchema>;
export type CreateActivityInput = z.output<typeof createActivitySchema>;
export type CreateTaskInput = z.output<typeof createTaskSchema>;
export type UpdateTaskInput = z.output<typeof updateTaskSchema>;
export type CreateNoteInput = z.output<typeof createNoteSchema>;
export type CreateSegmentInput = z.output<typeof createSegmentSchema>;
export type UpdateSegmentInput = z.output<typeof updateSegmentSchema>;
export type AssignSegmentInput = z.output<typeof assignSegmentSchema>;
export type CreateCustomerInput = z.output<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.output<typeof updateCustomerSchema>;
export type CreatePriceListInput = z.output<typeof createPriceListSchema>;
export type UpdatePriceListInput = z.output<typeof updatePriceListSchema>;
export type AddPriceItemInput = z.output<typeof addPriceItemSchema>;
