import { z } from "zod";

export const USER_STATUSES = ["active", "suspended"] as const;

const nameSchema = z
  .string()
  .trim()
  .min(2, "Nama minimal 2 karakter.")
  .max(100, "Nama maksimal 100 karakter.");

/** Dinormalisasi ke huruf kecil tanpa spasi tepi, sesuai constraint database. */
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Email terlalu panjang.")
  .pipe(z.email("Email tidak valid."));

/** Batas sama dengan konfigurasi Better Auth (minPasswordLength 12, maxPasswordLength 128). */
const passwordSchema = z
  .string()
  .min(12, "Kata sandi minimal 12 karakter.")
  .max(128, "Kata sandi maksimal 128 karakter.");

/** branchId null = role berlaku di semua cabang. */
const roleAssignmentSchema = z.object({
  roleId: z.uuid("ID role tidak valid."),
  branchId: z.uuid("ID cabang tidak valid.").nullable().default(null),
});

const roleAssignmentsSchema = z
  .array(roleAssignmentSchema)
  .max(20, "Maksimal 20 penugasan role.")
  .refine(
    (items) => new Set(items.map((i) => `${i.roleId}:${i.branchId ?? ""}`)).size === items.length,
    "Penugasan role tidak boleh duplikat.",
  );

export const createUserSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  roles: roleAssignmentsSchema.default([]),
});

export const updateUserSchema = z
  .object({
    name: nameSchema.optional(),
    email: emailSchema.optional(),
  })
  .refine((value) => value.name !== undefined || value.email !== undefined, {
    message: "Minimal satu field harus diisi.",
  });

export const setUserStatusSchema = z.object({
  status: z.enum(USER_STATUSES),
});

/** Mengganti SELURUH penugasan role pengguna dengan daftar ini. */
export const replaceUserRolesSchema = z.object({
  roles: roleAssignmentsSchema,
});

export const resetUserPasswordSchema = z.object({
  password: passwordSchema,
});

export type RoleAssignmentInput = z.output<typeof roleAssignmentSchema>;
export type CreateUserInput = z.output<typeof createUserSchema>;
export type UpdateUserInput = z.output<typeof updateUserSchema>;
export type SetUserStatusInput = z.output<typeof setUserStatusSchema>;
export type ReplaceUserRolesInput = z.output<typeof replaceUserRolesSchema>;
export type ResetUserPasswordInput = z.output<typeof resetUserPasswordSchema>;