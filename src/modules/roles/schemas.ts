import { z } from "zod";

/** Sama dengan constraint roles_code_format_chk. */
const roleCodeSchema = z
  .string()
  .trim()
  .min(3, "Kode role minimal 3 karakter.")
  .max(50, "Kode role maksimal 50 karakter.")
  .regex(
    /^[a-z][a-z0-9_]*$/,
    "Kode role hanya boleh huruf kecil, angka, dan underscore, serta diawali huruf.",
  );

const roleNameSchema = z
  .string()
  .trim()
  .min(2, "Nama role minimal 2 karakter.")
  .max(100, "Nama role maksimal 100 karakter.");

const roleDescriptionSchema = z.string().trim().max(500, "Deskripsi maksimal 500 karakter.");

/** Sama dengan constraint permissions_code_format_chk: modul.resource.aksi */
const permissionCodeSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/,
    "Format permission harus modul.resource.aksi.",
  );

const permissionCodesSchema = z
  .array(permissionCodeSchema)
  .max(500, "Terlalu banyak permission.")
  .refine((codes) => new Set(codes).size === codes.length, "Permission tidak boleh duplikat.");

export const createRoleSchema = z.object({
  code: roleCodeSchema,
  name: roleNameSchema,
  description: roleDescriptionSchema.optional(),
  permissionCodes: permissionCodesSchema.default([]),
});

/** Kode role tidak bisa diubah. permissionCodes, bila diisi, MENGGANTI seluruh permission role. */
export const updateRoleSchema = z
  .object({
    name: roleNameSchema.optional(),
    description: roleDescriptionSchema.nullable().optional(),
    permissionCodes: permissionCodesSchema.optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.description !== undefined ||
      value.permissionCodes !== undefined,
    { message: "Minimal satu field harus diisi." },
  );

export type CreateRoleInput = z.output<typeof createRoleSchema>;
export type UpdateRoleInput = z.output<typeof updateRoleSchema>;