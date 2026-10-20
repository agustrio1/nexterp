import { sql } from "drizzle-orm";

import { auditLogs, users } from "@/db/schema";
import { listAuditLogs } from "@/modules/audit/service";
import { loadGrants } from "@/server/authz";
import { db } from "@/server/db";

/** Skrip uji sementara untuk 3I-2 (hanya membaca). Boleh dihapus setelah semua hasil sesuai. */

async function expectError(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    console.log(label, "GAGAL: seharusnya ditolak");
  } catch (error) {
    const e = error as { code?: string; message?: string };
    console.log(label, e.code, "|", e.message);
  }
}

function cursorOf(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

async function main() {
  const [u] = await db.select({ id: users.id }).from(users).limit(1);
  if (!u) throw new Error("Belum ada pengguna.");

  const actor = {
    userId: u.id,
    name: "Uji",
    email: "uji@example.com",
    grants: await loadGrants(u.id),
  };

  const page1 = await listAuditLogs(actor, { limit: 5 });
  console.log("halaman 1", page1.items.length, page1.nextCursor !== null);

  const page2 = await listAuditLogs(actor, { limit: 5, cursor: page1.nextCursor ?? undefined });
  const ids1 = new Set(page1.items.map((i) => i.id));
  const noOverlap = page2.items.every((i) => !ids1.has(i.id));
  const lastOfPage1 = page1.items[page1.items.length - 1];
  const firstOfPage2 = page2.items[0];
  const ordered =
    lastOfPage1 !== undefined &&
    firstOfPage2 !== undefined &&
    firstOfPage2.at.getTime() <= lastOfPage1.at.getTime();
  console.log("halaman 2", page2.items.length, noOverlap, ordered);

  const byPrefix = await listAuditLogs(actor, { actionPrefix: "role.", limit: 200 });
  console.log(
    "awalan role.",
    byPrefix.items.length > 0,
    byPrefix.items.every((i) => i.action.startsWith("role.")),
  );

  const exact = await listAuditLogs(actor, { action: "role.create", limit: 200 });
  console.log(
    "tepat role.create",
    exact.items.length > 0,
    exact.items.every((i) => i.action === "role.create"),
  );

  const future = await listAuditLogs(actor, { dateFrom: "2100-01-01" });
  console.log("masa depan", future.items.length, future.nextCursor);

  // Menelusuri seluruh halaman harus menghasilkan setiap baris tepat satu kali.
  const [{ n: total = 0 } = {}] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditLogs);
  const seen: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await listAuditLogs(actor, { limit: 7, cursor });
    seen.push(...page.items.map((i) => i.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  console.log("semua halaman", new Set(seen).size === total, seen.length === total);

  await expectError("cursor rusak", () => listAuditLogs(actor, { cursor: "bukan-cursor-valid" }));
  await expectError("cursor bentuk salah", () =>
    listAuditLogs(actor, { cursor: cursorOf({ x: 1 }) }),
  );
  await expectError("cursor tanggal mustahil", () =>
    listAuditLogs(actor, {
      cursor: cursorOf({
        a: "2026-02-30T00:00:00.000000Z",
        i: "00000000-0000-4000-8000-000000000000",
      }),
    }),
  );
  await expectError("izin", () => listAuditLogs({ ...actor, grants: [] }));
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[test-audit-read] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });