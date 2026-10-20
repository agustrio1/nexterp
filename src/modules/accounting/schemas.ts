import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Bagan akun (Chart of Accounts)                                      */
/* ------------------------------------------------------------------ */

/**
 * Pola kode harus sama persis dengan check constraint DB
 * `chart_accounts_code_format_chk`: `^[A-Za-z0-9][A-Za-z0-9.-]*$`.
 * Di service huruf kecil akan di-normalisasi menjadi huruf besar, jadi regex di sini
 * sudah menerima keduanya. Tidak ada underscore (DB juga menolak).
 */
const accountCodeSchema = z
  .string()
  .trim()
  .min(2, "Kode akun minimal 2 karakter.")
  .max(30, "Kode akun maksimal 30 karakter.")
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9.-]*$/,
    "Kode akun hanya boleh huruf, angka, titik, dan strip; harus diawali huruf atau angka.",
  )
  .transform((value) => value.toUpperCase());

const accountNameSchema = z
  .string()
  .trim()
  .min(2, "Nama akun minimal 2 karakter.")
  .max(150, "Nama akun maksimal 150 karakter.");

const accountIdSchema = z.uuid("Format ID induk tidak valid.");

const descriptionSchema = z
  .string()
  .trim()
  .max(500, "Deskripsi maksimal 500 karakter.")
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional();

/** Enum tipe akun — sama dengan `accountTypeEnum` di skema Drizzle. */
export const ACCOUNT_TYPES = ["asset", "liability", "equity", "revenue", "expense"] as const;

const accountTypeSchema = z.enum(ACCOUNT_TYPES, {
  message: "Tipe akun harus salah satu dari asset/liability/equity/revenue/expense.",
});

export const createChartAccountSchema = z.strictObject({
  code: accountCodeSchema,
  name: accountNameSchema,
  /** Tipe hanya boleh dipilih saat pembuatan; tidak pernah berubah setelahnya. */
  type: accountTypeSchema,
  /** null atau tidak diisi = akun akar (root). */
  parentId: accountIdSchema.nullable().optional(),
  /**
   * Default true. Bila `parentId` menunjuk akun yang sedang `is_postable=true`,
   * service akan menolak; pemanggil harus menonaktifkan induk lebih dulu.
   */
  isPostable: z.boolean().default(true),
  description: descriptionSchema,
});

/**
 * Update: `code` dan `type` ditolak di sini (dan dijaga trigger DB).
 * `isPostable` dan `parentId` divalidasi oleh service terhadap aturan pohon & pemakaian jurnal.
 */
export const updateChartAccountSchema = z
  .strictObject({
    name: accountNameSchema.optional(),
    parentId: accountIdSchema.nullable().optional(),
    isPostable: z.boolean().optional(),
    isActive: z.boolean().optional(),
    description: descriptionSchema,
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    { message: "Minimal satu field harus diisi." },
  );

export const listChartAccountsQuerySchema = z.strictObject({
  isActive: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  isPostable: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  type: accountTypeSchema.optional(),
});

/* ------------------------------------------------------------------ */
/* Tipe                                                                */
/* ------------------------------------------------------------------ */

export type CreateChartAccountInput = z.output<typeof createChartAccountSchema>;
export type UpdateChartAccountInput = z.output<typeof updateChartAccountSchema>;
export type ListChartAccountsQuery = z.output<typeof listChartAccountsQuerySchema>;

/* ------------------------------------------------------------------ */
/* Jurnal manual (Tahap 4D) */
/* ------------------------------------------------------------------ */

const journalIdSchema = z.uuid("Format ID tidak valid.");
const journalDateSchema = z.iso.date("Tanggal harus berformat YYYY-MM-DD.");

/**
 * Nominal baris jurnal sebagai string desimal (sama seperti kolom numeric(18,2)),
 * tidak pernah number, supaya tidak melewati floating-point.
 * Harus > 0 dan pas dalam 16 digit bulat + 2 desimal.
 */
const journalAmountSchema = z
  .string()
  .trim()
  .regex(/^\d{1,16}(\.\d{1,2})?$/, "Nominal maksimal 16 digit bulat dan 2 desimal.")
  .refine((value) => /[1-9]/.test(value.replace(".", "")), "Nominal harus lebih besar dari nol.");

const journalMemoSchema = z
  .string()
  .trim()
  .max(200, "Memo maksimal 200 karakter.")
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional();

const journalDescriptionSchema = z
  .string()
  .trim()
  .min(3, "Deskripsi minimal 3 karakter.")
  .max(500, "Deskripsi maksimal 500 karakter.");

const journalReferenceSchema = z
  .string()
  .trim()
  .max(50, "Referensi maksimal 50 karakter.")
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional();

const journalReasonSchema = z
  .string()
  .trim()
  .min(5, "Alasan minimal 5 karakter.")
  .max(500, "Alasan maksimal 500 karakter.");

export const JOURNAL_STATUSES = ["draft", "posted", "reversed", "cancelled"] as const;

export const journalLineSchema = z.strictObject({
  accountId: journalIdSchema,
  side: z.enum(["debit", "credit"], { message: "Baris jurnal harus debit atau kredit." }),
  amount: journalAmountSchema,
  memo: journalMemoSchema,
  branchId: journalIdSchema.nullable().optional(),
  departmentId: journalIdSchema.nullable().optional(),
  costCenterId: journalIdSchema.nullable().optional(),
});

export const createJournalSchema = z.strictObject({
  entryDate: journalDateSchema,
  description: journalDescriptionSchema,
  reference: journalReferenceSchema,
  /** Minimal 2 baris; keseimbangan debit=kredit divalidasi oleh service + trigger DB. */
  lines: z.array(journalLineSchema).min(2, "Jurnal membutuhkan minimal 2 baris.").max(200),
  /** Kunci idempotensi tingkat API; column `idempotency_key` unique. */
  idempotencyKey: z
    .string()
    .trim()
    .min(8, "idempotencyKey minimal 8 karakter.")
    .max(200, "idempotencyKey maksimal 200 karakter.")
    .optional(),
});

/**
 * Update draf: mengganti seluruh baris (baris lama dihapus, baris baru disisipkan).
 * Hanya dapat dipakai selama status masih `draft` (dijaga oleh trigger DB).
 */
export const updateJournalSchema = z.strictObject({
  entryDate: journalDateSchema.optional(),
  description: journalDescriptionSchema.optional(),
  reference: journalReferenceSchema,
  lines: z.array(journalLineSchema).min(2, "Jurnal membutuhkan minimal 2 baris.").max(200),
});

export const cancelJournalSchema = z.strictObject({
  reason: journalReasonSchema,
});

export const reverseJournalSchema = z.strictObject({
  reason: journalReasonSchema,
  /** Opsional: tanggal reversal. Default = tanggal jurnal asal. */
  entryDate: journalDateSchema.optional(),
});

export const listJournalsQuerySchema = z
  .strictObject({
    status: z.enum(JOURNAL_STATUSES).optional(),
    dateFrom: journalDateSchema.optional(),
    dateTo: journalDateSchema.optional(),
    accountId: journalIdSchema.optional(),
    branchId: journalIdSchema.optional(),
    departmentId: journalIdSchema.optional(),
    limit: z
      .string()
      .regex(/^\d+$/, "limit harus berupa bilangan bulat.")
      .transform(Number)
      .pipe(z.number().int().min(1, "limit minimal 1.").max(200, "limit maksimal 200."))
      .optional(),
    cursor: z.string().min(1).max(500).optional(),
  })
  .refine((value) => !value.dateFrom || !value.dateTo || value.dateTo >= value.dateFrom, {
    path: ["dateTo"],
    message: "dateTo tidak boleh sebelum dateFrom.",
  });

/* ------------------------------------------------------------------ */
/* Tipe                                                                */
/* ------------------------------------------------------------------ */

export type CreateJournalInput = z.output<typeof createJournalSchema>;
export type UpdateJournalInput = z.output<typeof updateJournalSchema>;
export type CancelJournalInput = z.output<typeof cancelJournalSchema>;
export type ReverseJournalInput = z.output<typeof reverseJournalSchema>;
export type ListJournalsQuery = z.output<typeof listJournalsQuerySchema>;
export type JournalLineInput = z.output<typeof journalLineSchema>;