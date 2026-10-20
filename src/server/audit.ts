import { isIP } from "node:net";

import { headers } from "next/headers";

import { auditLogs } from "@/db/schema";
import { db } from "@/server/db";

/** Boleh `db` biasa maupun `tx` di dalam db.transaction(...). */
type AuditExecutor = Pick<typeof db, "insert">;

export type AuditEntry = {
  /** Format "entitas.aksi", mis. "user.create", "journal.post". */
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  /** Kosong = tindakan sistem. */
  actorId?: string | null;
};

const SENSITIVE_KEY = /(password|secret|token|apikey|api_key|authorization|cookie)/i;
const MAX_DEPTH = 6;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Mengganti nilai pada kunci sensitif dengan "[REDACTED]". Hanya objek polos dan array yang
 * ditelusuri; tipe lain (Date, Decimal, dll.) dibiarkan dan diserialisasi lewat toJSON.
 */
export function redactForAudit(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.map((item) => redactForAudit(item, depth + 1));
  if (!isPlainObject(value)) return value;

  const result: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactForAudit(inner, depth + 1);
  }
  return result;
}

type RequestContext = {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
};

const EMPTY_CONTEXT: RequestContext = { ip: null, userAgent: null, requestId: null };

/** headers() melempar error di luar request (script/seed); itu dianggap konteks kosong. */
async function readRequestContext(): Promise<RequestContext> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
    const candidate = forwarded || h.get("x-real-ip")?.trim() || "";

    return {
      // Kolom bertipe inet: nilai yang bukan IP valid akan membuat insert gagal, jadi disaring.
      ip: candidate && isIP(candidate) !== 0 ? candidate : null,
      userAgent: h.get("user-agent")?.slice(0, 512) ?? null,
      requestId: h.get("x-request-id") ?? null,
    };
  } catch {
    return EMPTY_CONTEXT;
  }
}

async function writeAudit(entry: AuditEntry, executor: AuditExecutor = db): Promise<void> {
  const context = await readRequestContext();

  await executor.insert(auditLogs).values({
    actorId: entry.actorId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: redactForAudit(entry.before) ?? null,
    after: redactForAudit(entry.after) ?? null,
    ip: context.ip,
    userAgent: context.userAgent,
    requestId: context.requestId,
  });
}

/**
 * Pemakaian:
 *   await audit.log({ action: "user.update", entityType: "user", entityId: id, before, after, actorId });
 *   await db.transaction(async (tx) => { ...; await audit.log(entry, tx); });
 */
export const audit = { log: writeAudit };