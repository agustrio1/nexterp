import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Helper                                                              */
/* ------------------------------------------------------------------ */

const emptyToNull = (value: string) => (value === "" ? null : value);

/** Teks opsional: string kosong menjadi null, null berarti mengosongkan nilai. */
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

const phoneSchema = z
  .string()
  .trim()
  .max(30, "Nomor telepon maksimal 30 karakter.")
  .transform(emptyToNull)
  .refine((value) => value === null || /^[0-9+()\-.\s]{5,30}$/.test(value), "Nomor telepon tidak valid.")
  .nullable()
  .optional();

/* ------------------------------------------------------------------ */
/* Profil perusahaan (PUT: buat atau timpa)                            */
/* ------------------------------------------------------------------ */

/** NPWP: titik, strip, dan spasi dibuang, sisanya harus 15 atau 16 digit. */
const taxIdSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[.\-\s]/g, ""))
  .transform(emptyToNull)
  .refine((value) => value === null || /^\d{15,16}$/.test(value), "NPWP harus 15 atau 16 digit angka.")
  .nullable()
  .optional();

const postalCodeSchema = z
  .string()
  .trim()
  .transform(emptyToNull)
  .refine((value) => value === null || /^\d{5}$/.test(value), "Kode pos harus 5 digit angka.")
  .nullable()
  .optional();

const emailSchema = z
  .string()
  .trim()
  .max(254, "Email maksimal 254 karakter.")
  .transform(emptyToNull)
  .pipe(z.email("Format email tidak valid.").nullable())
  .nullable()
  .optional();

const websiteSchema = z
  .string()
  .trim()
  .max(200, "Website maksimal 200 karakter.")
  .transform(emptyToNull)
  .refine(
    (value) => value === null || /^https?:\/\/\S+$/i.test(value),
    "Website harus diawali http:// atau https://.",
  )
  .nullable()
  .optional();

/** Field yang tidak dikirim diperlakukan sebagai kosong (null) oleh service. */
export const saveCompanyProfileSchema = z.strictObject({
  legalName: z
    .string()
    .trim()
    .min(2, "Nama resmi perusahaan minimal 2 karakter.")
    .max(200, "Nama resmi perusahaan maksimal 200 karakter."),
  tradeName: optionalText(200, "Nama dagang"),
  taxId: taxIdSchema,
  address: optionalText(500, "Alamat"),
  city: optionalText(100, "Kota"),
  province: optionalText(100, "Provinsi"),
  postalCode: postalCodeSchema,
  phone: phoneSchema,
  email: emailSchema,
  website: websiteSchema,
});

/* ------------------------------------------------------------------ */
/* Pengaturan aplikasi (PATCH)                                         */
/* ------------------------------------------------------------------ */

/** Dapat diubah lewat API. */
export const EDITABLE_SETTING_KEYS = [
  "timezone",
  "allow_negative_stock",
  "retained_earnings_account_id",
] as const;
/** Hanya dibaca: mengubahnya setelah ada transaksi merusak konsistensi akuntansi/stok. */
export const READ_ONLY_SETTING_KEYS = ["base_currency", "costing_method"] as const;

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("id-ID", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const timezoneSchema = z
  .string()
  .trim()
  .refine(isValidTimeZone, "Zona waktu tidak valid. Gunakan nama IANA, contoh Asia/Jakarta.");

const accountIdSettingSchema = z
  .string()
  .trim()
  .uuid("retained_earnings_account_id harus berupa UUID akun bagan.");

export const updateSettingsSchema = z
  .strictObject({
    timezone: timezoneSchema.optional(),
    allow_negative_stock: z.boolean().optional(),
    /** UUID akun ekuitas (postable, aktif) tujuan penutupan laba ditahan. */
    retained_earnings_account_id: accountIdSettingSchema.optional(),
  })
  .refine(hasAnyField, atLeastOneField);

/* ------------------------------------------------------------------ */
/* Cabang                                                              */
/* ------------------------------------------------------------------ */

function orgCodeSchema(label: string) {
  return z
    .string()
    .trim()
    .toUpperCase()
    .min(2, `Kode ${label} minimal 2 karakter.`)
    .max(20, `Kode ${label} maksimal 20 karakter.`)
    .regex(
      /^[A-Z0-9][A-Z0-9_-]*$/,
      `Kode ${label} hanya boleh huruf, angka, strip, dan underscore, serta diawali huruf atau angka.`,
    );
}

function orgNameSchema(label: string) {
  return z
    .string()
    .trim()
    .min(2, `Nama ${label} minimal 2 karakter.`)
    .max(100, `Nama ${label} maksimal 100 karakter.`);
}

export const createBranchSchema = z.strictObject({
  code: orgCodeSchema("cabang"),
  name: orgNameSchema("cabang"),
  address: optionalText(300, "Alamat"),
  phone: phoneSchema,
});

/** Kode cabang tidak bisa diubah. Field tak dikenal (termasuk code) ditolak. */
export const updateBranchSchema = z
  .strictObject({
    name: orgNameSchema("cabang").optional(),
    address: optionalText(300, "Alamat"),
    phone: phoneSchema,
    isActive: z.boolean().optional(),
  })
  .refine(hasAnyField, atLeastOneField);

export const listBranchesQuerySchema = z.strictObject({
  isActive: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

/* ------------------------------------------------------------------ */
/* Departemen                                                          */
/* ------------------------------------------------------------------ */

const idSchema = z.uuid("Format ID tidak valid.");

export const createDepartmentSchema = z.strictObject({
  code: orgCodeSchema("departemen"),
  name: orgNameSchema("departemen"),
  parentId: idSchema.nullable().optional(),
  // null atau tidak diisi = departemen berlaku untuk seluruh perusahaan.
  branchId: idSchema.nullable().optional(),
});

/** Kode departemen tidak bisa diubah. */
export const updateDepartmentSchema = z
  .strictObject({
    name: orgNameSchema("departemen").optional(),
    parentId: idSchema.nullable().optional(),
    branchId: idSchema.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine(hasAnyField, atLeastOneField);

export const listDepartmentsQuerySchema = z.strictObject({
  isActive: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  branchId: idSchema.optional(),
});

/* ------------------------------------------------------------------ */
/* Tipe                                                                */
/* ------------------------------------------------------------------ */

export type SaveCompanyProfileInput = z.output<typeof saveCompanyProfileSchema>;
export type UpdateSettingsInput = z.output<typeof updateSettingsSchema>;
export type CreateBranchInput = z.output<typeof createBranchSchema>;
export type UpdateBranchInput = z.output<typeof updateBranchSchema>;
export type ListBranchesQuery = z.output<typeof listBranchesQuerySchema>;
export type CreateDepartmentInput = z.output<typeof createDepartmentSchema>;
export type UpdateDepartmentInput = z.output<typeof updateDepartmentSchema>;
export type ListDepartmentsQuery = z.output<typeof listDepartmentsQuerySchema>;