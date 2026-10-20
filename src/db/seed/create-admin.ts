import { eq } from "drizzle-orm";
import { z } from "zod";

import { accounts, auditLogs, roles, userRoles, users } from "@/db/schema";
import { hashPassword } from "@/server/auth/password";
import { db } from "@/server/db";

/**
 * Membuat admin pertama (role super_admin). Nilai dibaca dari environment variable
 * di sesi terminal saja, tidak disimpan di file:
 *   ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD (minimal 12 karakter)
 * Prasyarat: `bun run db:seed` sudah dijalankan.
 */

const inputSchema = z.object({
  ADMIN_EMAIL: z.email(),
  ADMIN_NAME: z.string().trim().min(2).max(100),
  ADMIN_PASSWORD: z.string().min(12).max(128),
});

async function main() {
  const parsed = inputSchema.safeParse({
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_NAME: process.env.ADMIN_NAME,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  });

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Input admin tidak valid:\n${details}`);
  }

  const email = parsed.data.ADMIN_EMAIL.trim().toLowerCase();
  const name = parsed.data.ADMIN_NAME;
  // Hash dihitung di luar transaksi (operasi CPU).
  const passwordHash = await hashPassword(parsed.data.ADMIN_PASSWORD);

  const userId = await db.transaction(async (tx) => {
    const [role] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.code, "super_admin"))
      .limit(1);
    if (!role) {
      throw new Error("Role super_admin belum ada. Jalankan `bun run db:seed` terlebih dahulu.");
    }

    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing) {
      throw new Error(`Pengguna dengan email ${email} sudah ada.`);
    }

    const [user] = await tx
      .insert(users)
      .values({ name, email, emailVerified: true })
      .returning({ id: users.id });
    if (!user) {
      throw new Error("Gagal membuat pengguna.");
    }

    await tx.insert(accounts).values({
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: passwordHash,
    });
    await tx.insert(userRoles).values({ userId: user.id, roleId: role.id });
    await tx.insert(auditLogs).values({
      action: "user.bootstrap_admin",
      entityType: "user",
      entityId: user.id,
      after: { email, name, role: "super_admin" },
    });

    return user.id;
  });

  console.log(`[create-admin] Admin dibuat: ${email} (id: ${userId})`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[create-admin] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });