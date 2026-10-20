import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { auditLogs, companySettings, users } from "@/db/schema";
import type { ListAuditLogsQuery } from "@/modules/audit/schemas";
import { can, type AuthContext } from "@/server/authz";
import { db } from "@/server/db";
import { forbidden, validationFailed } from "@/server/errors";

const DEFAULT_LIMIT = 50;
const DEFAULT_TIME_ZONE = "Asia/Jakarta";

/** Waktu kursor berupa teks UTC dengan presisi mikrodetik, persis seperti dihasilkan query. */
const cursorSchema = z.object({
  a: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
  i: z.uuid(),
});

function encodeCursor(at: string, id: string): string {
  return Buffer.from(JSON.stringify({ a: at, i: id }), "utf8").toString("base64url");
}

function invalidCursor() {
  return validationFailed([{ path: "cursor", message: "Cursor tidak valid." }]);
}

function decodeCursor(raw: string): { at: string; id: string } {
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    if (parsed.success) return { at: parsed.data.a, id: parsed.data.i };
  } catch {
    // JSON atau base64 rusak: jatuh ke error di bawah.
  }
  throw invalidCursor();
}

/** Dua digit pertama SQLSTATE dari error driver, termasuk yang dibungkus Drizzle di `cause`. */
function pgErrorClass(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth++) {
    if ("code" in current && typeof current.code === "string" && current.code.length === 5) {
      return current.code.slice(0, 2);
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
}

async function companyTimeZone(): Promise<string> {
  const [row] = await db
    .select({ value: companySettings.value })
    .from(companySettings)
    .where(eq(companySettings.key, "timezone"))
    .limit(1);

  return typeof row?.value === "string" && row.value !== "" ? row.value : DEFAULT_TIME_ZONE;
}

/**
 * Daftar audit log, terbaru dulu, dengan paginasi kursor.
 * Izin: core.audit_logs.read. nextCursor bernilai null pada halaman terakhir.
 */
export async function listAuditLogs(actor: AuthContext, query: ListAuditLogsQuery = {}) {
  if (!can(actor.grants, "core.audit_logs.read")) throw forbidden();

  const limit = query.limit ?? DEFAULT_LIMIT;
  const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
  const timeZone = query.dateFrom || query.dateTo ? await companyTimeZone() : DEFAULT_TIME_ZONE;

  const conditions: (SQL | undefined)[] = [
    query.action === undefined ? undefined : eq(auditLogs.action, query.action),
    query.actionPrefix === undefined
      ? undefined
      : sql`starts_with(${auditLogs.action}, ${query.actionPrefix})`,
    query.entityType === undefined ? undefined : eq(auditLogs.entityType, query.entityType),
    query.entityId === undefined ? undefined : eq(auditLogs.entityId, query.entityId),
    query.actorId === undefined ? undefined : eq(auditLogs.actorId, query.actorId),
    // Tanggal dibaca menurut zona waktu perusahaan; dateTo mencakup seluruh harinya.
    query.dateFrom === undefined
      ? undefined
      : sql`${auditLogs.at} >= (${query.dateFrom}::date)::timestamp at time zone ${timeZone}`,
    query.dateTo === undefined
      ? undefined
      : sql`${auditLogs.at} < ((${query.dateTo}::date + 1)::timestamp at time zone ${timeZone})`,
    cursor === undefined
      ? undefined
      : sql`(${auditLogs.at}, ${auditLogs.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`,
  ];

  const runQuery = () =>
    db
      .select({
        id: auditLogs.id,
        at: auditLogs.at,
        atCursor: sql<string>`to_char(${auditLogs.at} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        actorId: auditLogs.actorId,
        actorName: users.name,
        actorEmail: users.email,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        before: auditLogs.before,
        after: auditLogs.after,
        ip: auditLogs.ip,
        userAgent: auditLogs.userAgent,
        requestId: auditLogs.requestId,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(and(...conditions))
      .orderBy(desc(auditLogs.at), desc(auditLogs.id))
      .limit(limit + 1);

  let rows: Awaited<ReturnType<typeof runQuery>>;
  try {
    rows = await runQuery();
  } catch (error) {
    // Kursor yang lolos bentuk tetapi mustahil (mis. 30 Februari) ditolak Postgres sebagai kesalahan data.
    if (cursor !== undefined && pgErrorClass(error) === "22") throw invalidCursor();
    throw error;
  }

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map((row) => {
      const { atCursor, ...item } = row;
      // atCursor hanya kolom bantu untuk kursor; tidak ikut ke respons.
      void atCursor;
      return item;
    }),
    nextCursor: hasMore && last ? encodeCursor(last.atCursor, last.id) : null,
  };
}