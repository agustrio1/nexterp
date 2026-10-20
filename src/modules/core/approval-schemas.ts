import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Bangunan blok yang dipakai bersama                                  */
/* ------------------------------------------------------------------ */

const uuidSchema = z.uuid("Format ID tidak valid.");

/**
 * `docType` bebas (engine tidak terikat dokumen), tapi distandardkan sebagai slug
 * berformat `nama` atau `modul.nama` huruf kecil, mis. "purchase_order", "sales.invoice".
 * Set jenis dokumen sebenarnya didaftarkan modul Tahap 5; di sini hanya dijaga formatnya.
 */
const docTypeSchema = z
  .string()
  .trim()
  .min(3, "Jenis dokumen minimal 3 karakter.")
  .max(80, "Jenis dokumen maksimal 80 karakter.")
  .regex(
    /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/,
    "Jenis dokumen harus slug huruf kecil (huruf/angka/underscore, boleh berdot seperti modul.nama).",
  );

const nameSchema = z
  .string()
  .trim()
  .min(2, "Nama minimal 2 karakter.")
  .max(150, "Nama maksimal 150 karakter.");

const noteSchema = z
  .string()
  .trim()
  .min(3, "Catatan minimal 3 karakter.")
  .max(500, "Catatan maksimal 500 karakter.");

/**
 * Nominal sebagai string desimal numeric(18,2), bukan number (hindari floating-point).
 * Nol diizinkan (batas rentang boleh 0). Format: maks 16 digit bulat + 2 desimal.
 */
const amountSchema = z
  .string()
  .trim()
  .regex(/^\d{1,16}(\.\d{1,2})?$/, "Nominal maksimal 16 digit bulat dan 2 desimal.");

const nullableAmount = amountSchema.nullable().optional();

const idSchema = uuidSchema;

/* ------------------------------------------------------------------ */
/* Alur persetujuan (approval_workflows + steps)                       */
/* ------------------------------------------------------------------ */

/** Satu langkah: ditujukan ke tepat satu role ATAU satu user (dijaga CHECK DB juga). */
export const approvalStepInputSchema = z
  .strictObject({
    approverRoleId: idSchema.optional(),
    approverUserId: idSchema.optional(),
  })
  .refine(
    (step) => (step.approverRoleId === undefined) !== (step.approverUserId === undefined),
    { message: "Setiap langkah harus menunjuk tepat satu: approverRoleId ATAU approverUserId." },
  );

export const createApprovalWorkflowSchema = z.strictObject({
  docType: docTypeSchema,
  name: nameSchema,
  branchId: idSchema.nullable().optional(),
  minAmount: nullableAmount,
  maxAmount: nullableAmount,
  isActive: z.boolean().default(true),
  /** Minimal satu langkah. `stepNo` diberikan berurutan oleh service (1..N). */
  steps: z.array(approvalStepInputSchema).min(1, "Alur membutuhkan minimal satu langkah.").max(50),
});

/**
 * Update alur. `steps` bila diisi mengganti SELURUH langkah (hapus-then-sisip),
 * agar konfigurasi alur selalu konsisten dan deklaratif.
 */
export const updateApprovalWorkflowSchema = z
  .strictObject({
    name: nameSchema.optional(),
    branchId: idSchema.nullable().optional(),
    minAmount: nullableAmount,
    maxAmount: nullableAmount,
    isActive: z.boolean().optional(),
    docType: docTypeSchema.optional(),
    steps: z.array(approvalStepInputSchema).min(1).max(50).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "Minimal satu field harus diisi.",
  });

export const listApprovalWorkflowsQuerySchema = z.strictObject({
  docType: docTypeSchema.optional(),
  isActive: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

/* ------------------------------------------------------------------ */
/* Permintaan persetujuan (approval_requests + actions)                */
/* ------------------------------------------------------------------ */

export const submitApprovalSchema = z.strictObject({
  docType: docTypeSchema,
  docId: idSchema,
  /** Nominal dokumen (untuk pencocokan rentang alur + pencatatan). Opsional. */
  amount: amountSchema.optional(),
  /** Cabang dokumen, dipakai HANYA untuk mencocokkan alur (tidak dipersisten di request). */
  branchId: idSchema.optional(),
});

export const actApprovalSchema = z.strictObject({
  action: z.enum(["approve", "reject"], { message: "Tindakan harus approve atau reject." }),
  note: noteSchema.optional(),
});

export const cancelApprovalSchema = z.strictObject({
  reason: noteSchema.optional(),
});

export const listApprovalRequestsQuerySchema = z
  .strictObject({
    status: z.enum(["pending", "approved", "rejected", "cancelled"]).optional(),
    docType: docTypeSchema.optional(),
    docId: idSchema.optional(),
    /** true = hanya permintaan yang langkah aktifnya menunggu tindakan saya. */
    forMe: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    limit: z
      .string()
      .regex(/^\d+$/, "limit harus berupa bilangan bulat.")
      .transform(Number)
      .pipe(z.number().int().min(1).max(200))
      .optional(),
    cursor: z.string().min(1).max(500).optional(),
  })
  .refine((value) => !value.docId || !!value.docType, {
    path: ["docType"],
    message: "Filter docId membutuhkan docType.",
  });

/* ------------------------------------------------------------------ */
/* Tipe                                                                */
/* ------------------------------------------------------------------ */

export type ApprovalStepInput = z.output<typeof approvalStepInputSchema>;
export type CreateApprovalWorkflowInput = z.output<typeof createApprovalWorkflowSchema>;
export type UpdateApprovalWorkflowInput = z.output<typeof updateApprovalWorkflowSchema>;
export type ListApprovalWorkflowsQuery = z.output<typeof listApprovalWorkflowsQuerySchema>;
export type SubmitApprovalInput = z.output<typeof submitApprovalSchema>;
export type ActApprovalInput = z.output<typeof actApprovalSchema>;
export type CancelApprovalInput = z.output<typeof cancelApprovalSchema>;
export type ListApprovalRequestsQuery = z.output<typeof listApprovalRequestsQuerySchema>;
