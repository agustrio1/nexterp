import { sql } from "drizzle-orm";
import { index, pgTable, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { primaryId, timestamptz } from "./_columns";
import { roles, users } from "./identity";
import { branches } from "./organization";

/**
 * Penugasan role ke user. branch_id NULL = role berlaku di semua cabang.
 * Dua unique index parsial menjaga keunikan untuk kasus global maupun per cabang.
 */
export const userRoles = pgTable(
  "user_roles",
  {
    id: primaryId(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid()
      .notNull()
      .references(() => roles.id),
    branchId: uuid().references(() => branches.id),
    grantedBy: uuid().references(() => users.id),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("user_roles_global_uq")
      .on(t.userId, t.roleId)
      .where(sql`${t.branchId} is null`),
    uniqueIndex("user_roles_branch_uq")
      .on(t.userId, t.roleId, t.branchId)
      .where(sql`${t.branchId} is not null`),
    index("user_roles_role_idx").on(t.roleId),
    index("user_roles_branch_idx").on(t.branchId),
  ],
);