import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core";

import { primaryId, timestamps, timestamptz } from "./_columns";

export const userStatusEnum = pgEnum("user_status", ["active", "suspended"]);

/**
 * Tabel pengguna. Kolom name, email, emailVerified, image, createdAt, updatedAt
 * mengikuti kebutuhan Better Auth; kredensial (hash password) disimpan di tabel accounts (3C).
 */
export const users = pgTable(
  "users",
  {
    id: primaryId(),
    name: text().notNull(),
    email: text().notNull().unique(),
    emailVerified: boolean().notNull().default(false),
    image: text(),
    status: userStatusEnum().notNull().default("active"),
    // FK + unique ke employees(id) dibuat di migrasi 0024 (raw SQL) untuk
    // menghindari import melingkar; arah link utama dipakai lewat employees.userId.
    employeeId: uuid(),
    failedLoginCount: integer().notNull().default(0),
    lockedUntil: timestamptz(),
    lastLoginAt: timestamptz(),
    ...timestamps(),
  },
  (t) => [
    // Menjamin keunikan email tanpa membedakan huruf besar/kecil.
    check("users_email_lowercase_chk", sql`${t.email} = lower(${t.email})`),
    check("users_failed_login_count_chk", sql`${t.failedLoginCount} >= 0`),
    // Keyset paginasi listUsers (Tahap 10C): urutan kanonik (created_at, id).
    // PG dapat melakukan backward scan untuk ORDER BY DESC sehingga indeks
    // ASC default cukup; tiebreaker `id` menjamin determinisme halaman.
    index("users_created_at_id_idx").on(t.createdAt, t.id),
  ],
);

export const roles = pgTable(
  "roles",
  {
    id: primaryId(),
    code: text().notNull().unique(),
    name: text().notNull(),
    description: text(),
    // Role bawaan sistem tidak boleh dihapus/diubah kodenya lewat UI.
    isSystem: boolean().notNull().default(false),
    ...timestamps(),
  },
  (t) => [check("roles_code_format_chk", sql`${t.code} ~ '^[a-z][a-z0-9_]*$'`)],
);

/** Format code: modul.resource.aksi, contoh accounting.journals.post */
export const permissions = pgTable(
  "permissions",
  {
    id: primaryId(),
    code: text().notNull().unique(),
    module: text().notNull(),
    description: text(),
    ...timestamps(),
  },
  (t) => [
    check(
      "permissions_code_format_chk",
      sql`${t.code} ~ '^[a-z][a-z0-9_]*[.][a-z][a-z0-9_]*[.][a-z][a-z0-9_]*$'`,
    ),
    check("permissions_module_match_chk", sql`split_part(${t.code}, '.', 1) = ${t.module}`),
  ],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid()
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid()
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permissionId] }),
    index("role_permissions_permission_idx").on(t.permissionId),
  ],
);