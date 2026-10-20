import { and, asc, eq, sql } from "drizzle-orm";

import { chartAccounts, journalEntryLines } from "@/db/schema";
import type {
  CreateChartAccountInput,
  ListChartAccountsQuery,
  UpdateChartAccountInput,
} from "@/modules/accounting/schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { businessRule, conflict, forbidden, notFound, validationFailed } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "select">;

/** Batas pengaman penelusuran rantai induk (data wajar jauh di bawah ini). */
const MAX_HIERARCHY_DEPTH = 100;

/**
 * Menjalankan `fn` di dalam transaksi baru (default) atau dalam `tx` eksternal
 * (dipakai oleh skrip uji agar dapat rollback tanpa mencemari DB).
 */
async function inTx<T>(externalTx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (externalTx) return fn(externalTx);
  return db.transaction(fn);
}

/* ------------------------------------------------------------------ */
/* Helper                                                              */
/* ------------------------------------------------------------------ */

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

const chartAccountColumns = {
  id: chartAccounts.id,
  code: chartAccounts.code,
  name: chartAccounts.name,
  type: chartAccounts.type,
  parentId: chartAccounts.parentId,
  isPostable: chartAccounts.isPostable,
  isActive: chartAccounts.isActive,
  description: chartAccounts.description,
  createdAt: chartAccounts.createdAt,
  updatedAt: chartAccounts.updatedAt,
};

async function loadChartAccount(reader: Reader, id: string) {
  const [row] = await reader
    .select(chartAccountColumns)
    .from(chartAccounts)
    .where(eq(chartAccounts.id, id))
    .limit(1);
  return row;
}

async function requireChartAccount(reader: Reader, id: string) {
  const row = await loadChartAccount(reader, id);
  if (!row) throw notFound("Akun tidak ditemukan.");
  return row;
}

/** Mengunci baris chart_accounts (FOR UPDATE) selama transaksi. */
async function lockChartAccount(tx: Tx, id: string) {
  const [row] = await tx
    .select(chartAccountColumns)
    .from(chartAccounts)
    .where(eq(chartAccounts.id, id))
    .for("update");
  if (!row) throw notFound("Akun tidak ditemukan.");
  return row;
}

/** Mengunci calon induk (FOR SHARE) agar tidak bisa diubah statusnya di tengah transaksi ini. */
async function lockParentShared(tx: Tx, parentId: string) {
  const [parent] = await tx
    .select({
      id: chartAccounts.id,
      type: chartAccounts.type,
      isPostable: chartAccounts.isPostable,
      isActive: chartAccounts.isActive,
    })
    .from(chartAccounts)
    .where(eq(chartAccounts.id, parentId))
    .for("share");

  if (!parent) {
    throw validationFailed([{ path: "parentId", message: "Akun induk tidak ditemukan." }]);
  }
  return parent;
}

/** Akun tidak boleh menjadi induk bagi dirinya sendiri, dan tipe anak = tipe induk. */
function assertParentCompatible(
  parent: { type: string; isPostable: boolean },
  childType: string,
): void {
  if (parent.type !== childType) {
    throw businessRule("Tipe akun anak harus sama dengan tipe akun induknya.");
  }
  if (parent.isPostable) {
    throw businessRule(
      "Induk yang akan memiliki anak harus berstatus non-postable. Ubah induk menjadi non-postable lebih dulu.",
    );
  }
}

/** Menelusuri rantai induk dari calon induk baru; bertemu akun ini berarti siklus. */
async function assertNoCycle(tx: Tx, accountId: string, newParentId: string): Promise<void> {
  let currentId: string | null = newParentId;

  for (let depth = 0; depth < MAX_HIERARCHY_DEPTH && currentId !== null; depth++) {
    if (currentId === accountId) {
      throw businessRule("Perubahan induk membentuk siklus pada hierarki bagan akun.");
    }

    const [row] = await tx
      .select({ parentId: chartAccounts.parentId })
      .from(chartAccounts)
      .where(eq(chartAccounts.id, currentId))
      .limit(1);
    currentId = row?.parentId ?? null;
  }

  if (currentId !== null) {
    throw new Error(`Hierarki bagan akun tidak wajar (lebih dari ${MAX_HIERARCHY_DEPTH} tingkat).`);
  }
}

async function countChildren(reader: Reader, parentId: string, activeOnly: boolean) {
  const [row] = await reader
    .select({ count: sql<number>`count(*)::int` })
    .from(chartAccounts)
    .where(
      activeOnly
        ? and(eq(chartAccounts.parentId, parentId), eq(chartAccounts.isActive, true))
        : eq(chartAccounts.parentId, parentId),
    );
  return row?.count ?? 0;
}

/**
 * Apakah akun sudah pernah dipakai sebagai baris jurnal. Bila sudah: tipe tidak bisa diubah (trigger DB),
 * isPostable tidak bisa dijadikan false, dan induk tidak boleh diganti (agar pelaporan historis konsisten).
 */
async function hasJournalUsage(reader: Reader, accountId: string): Promise<boolean> {
  const [row] = await reader
    .select({ id: journalEntryLines.id })
    .from(journalEntryLines)
    .where(eq(journalEntryLines.accountId, accountId))
    .limit(1);
  return row !== undefined;
}

/* ------------------------------------------------------------------ */
/* Baca                                                                */
/* ------------------------------------------------------------------ */

/** Daftar datar (pohon disusun lewat parentId oleh pemanggil). */
export async function listChartAccounts(
  actor: AuthContext,
  query: ListChartAccountsQuery = {},
  externalReader?: Tx,
) {
  assertCan(actor, "accounting.accounts.read");

  const conditions = [
    query.isActive === undefined ? undefined : eq(chartAccounts.isActive, query.isActive),
    query.isPostable === undefined ? undefined : eq(chartAccounts.isPostable, query.isPostable),
    query.type === undefined ? undefined : eq(chartAccounts.type, query.type),
  ];

  const reader = externalReader ?? db;
  return reader
    .select(chartAccountColumns)
    .from(chartAccounts)
    .where(and(...conditions))
    .orderBy(asc(chartAccounts.code));
}

export async function getChartAccount(actor: AuthContext, id: string, externalReader?: Tx) {
  assertCan(actor, "accounting.accounts.read");
  return requireChartAccount(externalReader ?? db, id);
}

/* ------------------------------------------------------------------ */
/* Tulis                                                               */
/* ------------------------------------------------------------------ */

export async function createChartAccount(
  actor: AuthContext,
  input: CreateChartAccountInput,
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.accounts.manage");

  return inTx(externalTx, async (tx) => {
    const [existing] = await tx
      .select({ id: chartAccounts.id })
      .from(chartAccounts)
      .where(eq(chartAccounts.code, input.code))
      .limit(1);
    if (existing) throw conflict("Kode akun sudah dipakai.");

    const parentId = input.parentId ?? null;
    const isPostable = input.isPostable;

    if (parentId !== null) {
      const parent = await lockParentShared(tx, parentId);
      if (!parent.isActive) throw businessRule("Akun induk tidak aktif.");
      assertParentCompatible(parent, input.type);
    }

    const values = {
      code: input.code,
      name: input.name,
      type: input.type,
      parentId,
      isPostable,
      description: input.description ?? null,
    };

    const [created] = await tx
      .insert(chartAccounts)
      .values({ ...values, isActive: true, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: chartAccounts.id });
    if (!created) throw new Error("Gagal membuat akun.");

    await audit.log(
      {
        action: "account.create",
        entityType: "chart_account",
        entityId: created.id,
        actorId: actor.userId,
        after: values,
      },
      tx,
    );

    return requireChartAccount(tx, created.id);
  });
}

const UPDATABLE_FIELDS = ["name", "parentId", "isPostable", "isActive", "description"] as const;

export async function updateChartAccount(
  actor: AuthContext,
  id: string,
  input: UpdateChartAccountInput,
  externalTx?: Tx,
) {
  assertCan(actor, "accounting.accounts.manage");

  return inTx(externalTx, async (tx) => {
    // Perubahan yang menyentuh hierarki/status diserialkan agar dua operasi
    // paralel tidak membentuk siklus dan urutan penguncian baris konsisten.
    const touchesHierarchy =
      input.parentId !== undefined ||
      input.isPostable !== undefined ||
      input.isActive !== undefined;
    if (touchesHierarchy) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('erp.chart_accounts.hierarchy'))`);
    }

    const account = await lockChartAccount(tx, id);

    const next = {
      name: input.name ?? account.name,
      parentId: input.parentId === undefined ? account.parentId : input.parentId,
      isPostable: input.isPostable ?? account.isPostable,
      isActive: input.isActive ?? account.isActive,
      description: input.description === undefined ? account.description : input.description,
    };

    const changedFields = UPDATABLE_FIELDS.filter((field) => next[field] !== account[field]);
    if (changedFields.length === 0) return account;

    // Perhatian pemakaian jurnal hanya relevan bila perubahan menyentuh kolom yang
    // dipengaruhi: isPostable (jadi false) atau parentId (pindah induk).
    const parentChanged = next.parentId !== account.parentId;
    const becomingPostable = !account.isPostable && next.isPostable;
    const becomingNonPostable = account.isPostable && !next.isPostable;
    const deactivating = account.isActive && !next.isActive;
    const activating = !account.isActive && next.isActive;

    const hasUsage =
      becomingNonPostable || parentChanged ? await hasJournalUsage(tx, id) : false;

    if (next.parentId === id) {
      throw businessRule("Akun tidak dapat menjadi induk bagi dirinya sendiri.");
    }

    if (parentChanged && hasUsage) {
      throw conflict("Akun yang sudah dipakai baris jurnal tidak dapat dipindah induknya.");
    }

    if (becomingNonPostable && hasUsage) {
      throw conflict(
        "Akun yang sudah dipakai baris jurnal tidak dapat dijadikan non-postable; buat akun induk baru dan pindahkan pemakaian lewat reversal.",
      );
    }

    if (parentChanged || activating) {
      if (next.parentId !== null) {
        const parent = await lockParentShared(tx, next.parentId);
        if ((parentChanged || activating) && !parent.isActive) {
          throw businessRule("Akun induk tidak aktif.");
        }
        if (parentChanged) {
          await assertNoCycle(tx, id, next.parentId);
        }
        // Tipe anak tidak pernah berubah (dijaga trigger), jadi cukup periksa induk baru.
        assertParentCompatible(parent, account.type);
      }
    }

    // Aturan pohon: akun yang punya anak tidak boleh dijadikan postable.
    if (becomingPostable) {
      const totalChildren = await countChildren(tx, id, false);
      if (totalChildren > 0) {
        throw businessRule("Akun yang memiliki anak tidak dapat dijadikan postable.");
      }
    }

    // Menonaktifkan induk dengan anak aktif ditolak.
    if (deactivating) {
      const activeChildren = await countChildren(tx, id, true);
      if (activeChildren > 0) {
        throw conflict(`Akun masih memiliki ${activeChildren} akun anak aktif.`);
      }
    }

    await tx
      .update(chartAccounts)
      .set({ ...next, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(chartAccounts.id, id));

    await audit.log(
      {
        action: "account.update",
        entityType: "chart_account",
        entityId: id,
        actorId: actor.userId,
        before: Object.fromEntries(changedFields.map((field) => [field, account[field]])),
        after: Object.fromEntries(changedFields.map((field) => [field, next[field]])),
      },
      tx,
    );

    return requireChartAccount(tx, id);
  });
}