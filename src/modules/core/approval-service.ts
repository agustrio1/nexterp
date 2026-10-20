import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import {
  approvalActions,
  approvalRequests,
  approvalWorkflowSteps,
  approvalWorkflows,
  branches,
  roles,
  userRoles,
  users,
} from "@/db/schema";
import { cmp } from "@/lib/money";
import type {
  ActApprovalInput,
  ApprovalStepInput,
  CancelApprovalInput,
  CreateApprovalWorkflowInput,
  ListApprovalRequestsQuery,
  ListApprovalWorkflowsQuery,
  SubmitApprovalInput,
  UpdateApprovalWorkflowInput,
} from "@/modules/core/approval-schemas";
import { audit } from "@/server/audit";
import { can, type AuthContext, type PermissionCode } from "@/server/authz";
import { db } from "@/server/db";
import { businessRule, conflict, forbidden, notFound, validationFailed } from "@/server/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "select">;

const DEFAULT_LIST_LIMIT = 50;

/** Jalankan `fn` di tx eksternal (uji/atomik dokumen) atau transaksi baru. */
async function inTx<T>(externalTx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (externalTx) return fn(externalTx);
  return db.transaction(fn);
}

function assertCan(actor: AuthContext, permission: PermissionCode): void {
  if (!can(actor.grants, permission)) throw forbidden();
}

/* ------------------------------------------------------------------ */
/* Kolom                                                               */
/* ------------------------------------------------------------------ */

const workflowColumns = {
  id: approvalWorkflows.id,
  docType: approvalWorkflows.docType,
  name: approvalWorkflows.name,
  branchId: approvalWorkflows.branchId,
  minAmount: approvalWorkflows.minAmount,
  maxAmount: approvalWorkflows.maxAmount,
  isActive: approvalWorkflows.isActive,
  createdAt: approvalWorkflows.createdAt,
  updatedAt: approvalWorkflows.updatedAt,
  createdBy: approvalWorkflows.createdBy,
  updatedBy: approvalWorkflows.updatedBy,
};

const stepColumns = {
  id: approvalWorkflowSteps.id,
  workflowId: approvalWorkflowSteps.workflowId,
  stepNo: approvalWorkflowSteps.stepNo,
  approverRoleId: approvalWorkflowSteps.approverRoleId,
  approverUserId: approvalWorkflowSteps.approverUserId,
};

const requestColumns = {
  id: approvalRequests.id,
  docType: approvalRequests.docType,
  docId: approvalRequests.docId,
  workflowId: approvalRequests.workflowId,
  status: approvalRequests.status,
  currentStep: approvalRequests.currentStep,
  amount: approvalRequests.amount,
  requestedBy: approvalRequests.requestedBy,
  requestedAt: approvalRequests.requestedAt,
  completedAt: approvalRequests.completedAt,
  createdAt: approvalRequests.createdAt,
  updatedAt: approvalRequests.updatedAt,
};

const actionColumns = {
  id: approvalActions.id,
  requestId: approvalActions.requestId,
  stepNo: approvalActions.stepNo,
  actorId: approvalActions.actorId,
  action: approvalActions.action,
  note: approvalActions.note,
  actedAt: approvalActions.actedAt,
};

/* ------------------------------------------------------------------ */
/* Helper validasi referensi approver                                  */
/* ------------------------------------------------------------------ */

/** Pastikan setiap approverRoleId/approverUserId pada langkah benar-benar ada. */
async function assertApproversExist(tx: Tx, steps: readonly ApprovalStepInput[]): Promise<void> {
  const roleIds = [...new Set(steps.map((s) => s.approverRoleId).filter((v): v is string => !!v))];
  const userIds = [...new Set(steps.map((s) => s.approverUserId).filter((v): v is string => !!v))];

  const issues: { path: string; message: string }[] = [];

  if (roleIds.length > 0) {
    const found = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(inArray(roles.id, roleIds));
    const ok = new Set(found.map((r) => r.id));
    if (roleIds.some((id) => !ok.has(id))) {
      issues.push({ path: "steps", message: "Salah satu role approver tidak ditemukan." });
    }
  }

  if (userIds.length > 0) {
    const found = await tx
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.id, userIds));
    const ok = new Set(found.map((u) => u.id));
    if (userIds.some((id) => !ok.has(id))) {
      issues.push({ path: "steps", message: "Salah satu pengguna approver tidak ditemukan." });
    }
  }

  if (issues.length > 0) throw validationFailed(issues);
}

async function assertBranchActive(reader: Reader, branchId: string): Promise<void> {
  const [row] = await reader
    .select({ id: branches.id, isActive: branches.isActive })
    .from(branches)
    .where(eq(branches.id, branchId))
    .limit(1);
  if (!row) throw validationFailed([{ path: "branchId", message: "Cabang tidak ditemukan." }]);
  if (!row.isActive)
    throw businessRule("Cabang tidak aktif; tidak dapat dipakai sebagai cakupan alur persetujuan.");
}

/** Rentang nilai alur: min tidak boleh melebihi max (CHECK DB juga menegakkan). */
function assertAmountRange(minAmount: string | null | undefined, maxAmount: string | null | undefined): void {
  if (minAmount != null && maxAmount != null && cmp(minAmount, maxAmount) > 0) {
    throw validationFailed([
      { path: "minAmount", message: "minAmount tidak boleh lebih besar dari maxAmount." },
    ]);
  }
}

/* ------------------------------------------------------------------ */
/* Alur: tulis                                                         */
/* ------------------------------------------------------------------ */

async function insertSteps(tx: Tx, workflowId: string, steps: readonly ApprovalStepInput[]) {
  await tx.insert(approvalWorkflowSteps).values(
    steps.map((step, index) => ({
      workflowId,
      stepNo: index + 1,
      approverRoleId: step.approverRoleId ?? null,
      approverUserId: step.approverUserId ?? null,
    })),
  );
}

export async function createApprovalWorkflow(
  actor: AuthContext,
  input: CreateApprovalWorkflowInput,
  externalTx?: Tx,
) {
  assertCan(actor, "core.approval_workflows.manage");

  return inTx(externalTx, async (tx) => {
    if (input.branchId != null) await assertBranchActive(tx, input.branchId);
    assertAmountRange(input.minAmount, input.maxAmount);
    await assertApproversExist(tx, input.steps);

    const [created] = await tx
      .insert(approvalWorkflows)
      .values({
        docType: input.docType,
        name: input.name,
        branchId: input.branchId ?? null,
        minAmount: input.minAmount ?? null,
        maxAmount: input.maxAmount ?? null,
        isActive: input.isActive,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning(workflowColumns);

    await insertSteps(tx, created.id, input.steps);

    await audit.log(
      {
        action: "approval.workflow.create",
        entityType: "approval_workflow",
        entityId: created.id,
        after: { ...created, steps: input.steps },
        actorId: actor.userId,
      },
      tx,
    );

    const steps = await loadSteps(tx, created.id);
    return { ...created, steps };
  });
}

async function lockWorkflow(tx: Tx, id: string) {
  const [row] = await tx
    .select(workflowColumns)
    .from(approvalWorkflows)
    .where(eq(approvalWorkflows.id, id))
    .for("update")
    .limit(1);
  if (!row) throw notFound("Alur persetujuan tidak ditemukan.");
  return row;
}

export async function updateApprovalWorkflow(
  actor: AuthContext,
  id: string,
  input: UpdateApprovalWorkflowInput,
  externalTx?: Tx,
) {
  assertCan(actor, "core.approval_workflows.manage");

  return inTx(externalTx, async (tx) => {
    const before = await lockWorkflow(tx, id);
    const beforeSteps = await loadSteps(tx, id);

    if (input.branchId != null) await assertBranchActive(tx, input.branchId);
    if (input.steps) await assertApproversExist(tx, input.steps);

    const next = {
      docType: input.docType ?? before.docType,
      name: input.name ?? before.name,
      branchId: input.branchId === undefined ? before.branchId : input.branchId ?? null,
      minAmount: input.minAmount === undefined ? before.minAmount : input.minAmount ?? null,
      maxAmount: input.maxAmount === undefined ? before.maxAmount : input.maxAmount ?? null,
      isActive: input.isActive ?? before.isActive,
    };

    // Rentang nilai harus min <= max (CHECK DB juga menegakkan; ini pesan yang lebih ramah).
    assertAmountRange(next.minAmount, next.maxAmount);

    await tx
      .update(approvalWorkflows)
      .set({ ...next, updatedAt: new Date(), updatedBy: actor.userId })
      .where(eq(approvalWorkflows.id, id));

    if (input.steps) {
      await tx.delete(approvalWorkflowSteps).where(eq(approvalWorkflowSteps.workflowId, id));
      await insertSteps(tx, id, input.steps);
    }

    const after = await loadWorkflow(tx, id);
    const afterSteps = await loadSteps(tx, id);

    await audit.log(
      {
        action: "approval.workflow.update",
        entityType: "approval_workflow",
        entityId: id,
        before: { ...before, steps: beforeSteps },
        after: { ...after, steps: afterSteps },
        actorId: actor.userId,
      },
      tx,
    );

    return { ...after, steps: afterSteps };
  });
}

/* ------------------------------------------------------------------ */
/* Alur: baca                                                          */
/* ------------------------------------------------------------------ */

async function loadWorkflow(reader: Reader, id: string) {
  const [row] = await reader
    .select(workflowColumns)
    .from(approvalWorkflows)
    .where(eq(approvalWorkflows.id, id))
    .limit(1);
  return row;
}

async function loadSteps(reader: Reader, workflowId: string) {
  return reader
    .select(stepColumns)
    .from(approvalWorkflowSteps)
    .where(eq(approvalWorkflowSteps.workflowId, workflowId))
    .orderBy(asc(approvalWorkflowSteps.stepNo));
}

export async function getApprovalWorkflow(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "core.approval_workflows.read");

  return inTx(externalTx, async (tx) => {
    const workflow = await loadWorkflow(tx, id);
    if (!workflow) throw notFound("Alur persetujuan tidak ditemukan.");
    const steps = await loadSteps(tx, id);
    return { ...workflow, steps };
  });
}

export async function listApprovalWorkflows(
  actor: AuthContext,
  query: ListApprovalWorkflowsQuery = {},
  externalTx?: Tx,
) {
  assertCan(actor, "core.approval_workflows.read");

  const reader = externalTx ?? db;
  const conditions: (SQL | undefined)[] = [
    query.docType === undefined ? undefined : eq(approvalWorkflows.docType, query.docType),
    query.isActive === undefined ? undefined : eq(approvalWorkflows.isActive, query.isActive),
  ];

  return reader
    .select(workflowColumns)
    .from(approvalWorkflows)
    .where(and(...conditions))
    .orderBy(asc(approvalWorkflows.docType), desc(approvalWorkflows.createdAt));
}

/* ------------------------------------------------------------------ */
/* Pencocokan alur saat pengajuan                                    */
/* ------------------------------------------------------------------ */

/**
 * Cari tepat satu alur aktif untuk (docType, branch, amount):
 *  - cocok docType & isActive, dan (branch alur global ATAU sama dengan cabang dokumen)
 *  - rentang nilai harus memuat amount (bila alur menetapkan batas; amount takProvided
 *    hanya lolos ke alur tanpa batas)
 *  - di antara yang cocok, alur bercabang spesifik diprioritaskan di atas alur global
 *  - 0 -> businessRule; >1 pada tingkat yang sama -> conflict (ambigu)
 */
async function findMatchingWorkflow(
  tx: Tx,
  docType: string,
  amount: string | undefined,
  branchId: string | undefined,
) {
  const candidates = await tx
    .select(workflowColumns)
    .from(approvalWorkflows)
    .where(
      and(
        eq(approvalWorkflows.docType, docType),
        eq(approvalWorkflows.isActive, true),
        branchId === undefined
          ? undefined
          : or(isNull(approvalWorkflows.branchId), eq(approvalWorkflows.branchId, branchId)),
      ),
    );

  const matches = candidates.filter((wf) => {
    const bounded = wf.minAmount != null || wf.maxAmount != null;
    if (!bounded) return true;
    if (amount == null) return false; // alur berbatas butuh nominal untuk dievaluasi
    if (wf.minAmount != null && cmp(amount, wf.minAmount) < 0) return false;
    if (wf.maxAmount != null && cmp(amount, wf.maxAmount) > 0) return false;
    return true;
  });

  if (matches.length === 0) {
    throw businessRule(
      `Tidak ada alur persetujuan aktif untuk jenis dokumen "${docType}" dengan nilai/cabang ini.`,
    );
  }

  // Prioritas: alur dengan branch spesifik > alur global, hanya bila cabang dokumen diketahui.
  let top = matches;
  if (branchId !== undefined) {
    const specific = matches.filter((wf) => wf.branchId === branchId);
    if (specific.length > 0) top = specific;
  }

  if (top.length > 1) {
    throw conflict(
      "Konfigurasi alur persetujuan ambigu: lebih dari satu alur cocok. Perbaiki rentang/cabang alur.",
    );
  }

  return top[0]!;
}

/* ------------------------------------------------------------------ */
/* Permintaan: tulis                                                   */
/* ------------------------------------------------------------------ */

export async function submitApproval(actor: AuthContext, input: SubmitApprovalInput, externalTx?: Tx) {
  assertCan(actor, "core.approvals.request");

  return inTx(externalTx, async (tx) => {
    // Satu dokumen hanya boleh punya satu pengajuan berjalan (unique parsial DB juga menjaga).
    const [pending] = await tx
      .select({ id: approvalRequests.id })
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.docType, input.docType),
          eq(approvalRequests.docId, input.docId),
          eq(approvalRequests.status, "pending"),
        ),
      )
      .limit(1);
    if (pending) throw conflict("Dokumen ini sudah memiliki pengajuan persetujuan yang berjalan.");

    const workflow = await findMatchingWorkflow(tx, input.docType, input.amount, input.branchId);
    const steps = await loadSteps(tx, workflow.id);
    if (steps.length === 0) {
      throw businessRule("Alur persetujuan yang cocok tidak memiliki langkah.");
    }

    const [created] = await tx
      .insert(approvalRequests)
      .values({
        docType: input.docType,
        docId: input.docId,
        workflowId: workflow.id,
        status: "pending",
        currentStep: 1,
        amount: input.amount ?? null,
        requestedBy: actor.userId,
      })
      .returning(requestColumns);

    await audit.log(
      {
        action: "approval.request.submit",
        entityType: "approval_request",
        entityId: created.id,
        after: { ...created, workflowId: workflow.id },
        actorId: actor.userId,
      },
      tx,
    );

    return { ...created, workflow: { id: workflow.id, name: workflow.name, steps } };
  });
}

async function lockRequest(tx: Tx, id: string) {
  const [row] = await tx
    .select(requestColumns)
    .from(approvalRequests)
    .where(eq(approvalRequests.id, id))
    .for("update")
    .limit(1);
  if (!row) throw notFound("Permintaan persetujuan tidak ditemukan.");
  return row;
}

/** Apakah aktor memegang role approver, dengan memperhatikan cakupan cabang alur. */
async function actorHoldsRole(tx: Tx, userId: string, roleId: string, workflowBranchId: string | null) {
  const rows = await tx
    .select({ branchId: userRoles.branchId })
    .from(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)));
  return rows.some(
    (r) => r.branchId === null || (workflowBranchId !== null && r.branchId === workflowBranchId),
  );
}

export async function actOnApproval(
  actor: AuthContext,
  id: string,
  input: ActApprovalInput,
  externalTx?: Tx,
) {
  assertCan(actor, "core.approvals.act");

  return inTx(externalTx, async (tx) => {
    const request = await lockRequest(tx, id);
    if (request.status !== "pending") {
      throw businessRule(`Hanya permintaan berstatus pending yang dapat ditindak (status: ${request.status}).`);
    }

    // Pemisahan tugas: pengaju tidak boleh menyetujui/menolak pengajuannya sendiri.
    if (request.requestedBy === actor.userId) {
      throw businessRule("Anda tidak dapat menyetujui atau menolak pengajuan Anda sendiri.");
    }

    const workflow = await loadWorkflow(tx, request.workflowId);
    if (!workflow) throw notFound("Alur persetujuan permintaan ini tidak ditemukan.");
    const steps = await loadSteps(tx, request.workflowId);
    const current = steps.find((s) => s.stepNo === request.currentStep);
    if (!current) {
      throw businessRule("Langkah aktif tidak ditemukan pada alur; periksa konfigurasi alur persetujuan.");
    }

    // Kelayakan: approver user yang ditunjuk, atau pemegang role approver pada cakupan cabang.
    const eligible =
      (current.approverUserId != null && current.approverUserId === actor.userId) ||
      (current.approverRoleId != null &&
        (await actorHoldsRole(tx, actor.userId, current.approverRoleId, workflow.branchId)));
    if (!eligible) throw forbidden("Anda bukan approver untuk langkah persetujuan ini.");

    // Catat aksi (unique request+step+actor mencegah aksi ganda orang yang sama pada langkah sama).
    const [action] = await tx
      .insert(approvalActions)
      .values({
        requestId: request.id,
        stepNo: current.stepNo,
        actorId: actor.userId,
        action: input.action,
        note: input.note ?? null,
      })
      .returning(actionColumns);

    const now = new Date();
    let patch: Partial<typeof approvalRequests.$inferSelect>;
    if (input.action === "reject") {
      patch = { status: "rejected", completedAt: now };
    } else if (request.currentStep < steps.length) {
      patch = { currentStep: request.currentStep + 1 };
    } else {
      patch = { status: "approved", completedAt: now };
    }

    await tx
      .update(approvalRequests)
      .set({ ...patch, updatedAt: now })
      .where(eq(approvalRequests.id, request.id));

    const after = await loadRequest(tx, request.id);

    await audit.log(
      {
        action: "approval.request.act",
        entityType: "approval_request",
        entityId: request.id,
        before: request,
        after,
        actorId: actor.userId,
      },
      tx,
    );

    return { request: after, action };
  });
}

export async function cancelApproval(
  actor: AuthContext,
  id: string,
  input: CancelApprovalInput,
  externalTx?: Tx,
) {
  return inTx(externalTx, async (tx) => {
    const request = await lockRequest(tx, id);
    if (request.status !== "pending") {
      throw businessRule(`Hanya permintaan berstatus pending yang dapat dibatalkan (status: ${request.status}).`);
    }

    // Pengaju boleh menarik sendiri; selain itu butuh izin core.approvals.cancel.
    const isRequester = request.requestedBy === actor.userId;
    if (!isRequester) assertCan(actor, "core.approvals.cancel");

    const now = new Date();
    await tx
      .update(approvalRequests)
      .set({ status: "cancelled", completedAt: now, updatedAt: now })
      .where(eq(approvalRequests.id, id));

    const after = await loadRequest(tx, id);

    await audit.log(
      {
        action: "approval.request.cancel",
        entityType: "approval_request",
        entityId: id,
        before: request,
        after: { ...after, reason: input.reason ?? null },
        actorId: actor.userId,
      },
      tx,
    );

    return after;
  });
}

/* ------------------------------------------------------------------ */
/* Permintaan: baca                                                    */
/* ------------------------------------------------------------------ */

async function loadRequest(reader: Reader, id: string) {
  const [row] = await reader
    .select(requestColumns)
    .from(approvalRequests)
    .where(eq(approvalRequests.id, id))
    .limit(1);
  return row;
}

async function loadActions(reader: Reader, requestId: string) {
  return reader
    .select(actionColumns)
    .from(approvalActions)
    .where(eq(approvalActions.requestId, requestId))
    .orderBy(asc(approvalActions.stepNo), asc(approvalActions.actedAt));
}

export async function getApprovalRequest(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "core.approvals.read");

  return inTx(externalTx, async (tx) => {
    const request = await loadRequest(tx, id);
    if (!request) throw notFound("Permintaan persetujuan tidak ditemukan.");
    const steps = await loadSteps(tx, request.workflowId);
    const actions = await loadActions(tx, id);
    return { ...request, steps, actions };
  });
}

const cursorSchema = z.object({ t: z.iso.datetime(), i: z.uuid() });

function encodeCursor(requestedAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ t: requestedAt.toISOString(), i: id }), "utf8").toString("base64url");
}

function decodeCursor(raw: string): { requestedAt: string; id: string } {
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    if (parsed.success) return { requestedAt: parsed.data.t, id: parsed.data.i };
  } catch {
    // fallthrough
  }
  throw validationFailed([{ path: "cursor", message: "Cursor tidak valid." }]);
}

/**
 * Daftar permintaan persetujuan, keyset (requestedAt DESC, id DESC).
 * `forMe=true` memfilter hanya permintaan yang langkah aktifnya menunggu tindakan
 * aktor ini (approver user yang ditunjuk ATAU pemegang role approver), kecuali
 * pengajuan milik sendiri (tolok SoD).
 */
export async function listApprovalRequests(
  actor: AuthContext,
  query: ListApprovalRequestsQuery = {},
  externalTx?: Tx,
) {
  assertCan(actor, "core.approvals.read");

  const limit = query.limit ?? DEFAULT_LIST_LIMIT;
  const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);

  const conditions: (SQL | undefined)[] = [
    query.status === undefined ? undefined : eq(approvalRequests.status, query.status),
    query.docType === undefined ? undefined : eq(approvalRequests.docType, query.docType),
    query.docId === undefined ? undefined : eq(approvalRequests.docId, query.docId),
    query.forMe
      ? sql`exists (
            select 1 from approval_workflow_steps s
            where s.workflow_id = ${approvalRequests.workflowId}
              and s.step_no = ${approvalRequests.currentStep}
              and ${approvalRequests.requestedBy} <> ${actor.userId}
              and (
                s.approver_user_id = ${actor.userId}
                or s.approver_role_id in (
                  select ur.role_id from user_roles ur where ur.user_id = ${actor.userId}
                )
              )
          )`
      : undefined,
    cursor === undefined
      ? undefined
      : sql`(${approvalRequests.requestedAt}, ${approvalRequests.id}) < (${cursor.requestedAt}::timestamptz, ${cursor.id}::uuid)`,
  ];

  const reader = externalTx ?? db;
  const rows = await reader
    .select(requestColumns)
    .from(approvalRequests)
    .where(and(...conditions))
    .orderBy(desc(approvalRequests.requestedAt), desc(approvalRequests.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page,
    nextCursor: hasMore && last ? encodeCursor(last.requestedAt, last.id) : null,
  };
}
