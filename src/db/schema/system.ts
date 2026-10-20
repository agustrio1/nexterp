import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { actorColumns } from "./_actors";
import { primaryId, timestamps, timestamptz } from "./_columns";
import { roles, users } from "./identity";
import { branches } from "./organization";

export const numberingResetPolicyEnum = pgEnum("numbering_reset_policy", [
  "never",
  "yearly",
  "monthly",
]);
export const approvalRequestStatusEnum = pgEnum("approval_request_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);
export const approvalActionTypeEnum = pgEnum("approval_action_type", ["approve", "reject"]);
export const idempotencyStatusEnum = pgEnum("idempotency_status", ["in_progress", "completed"]);
export const outboxStatusEnum = pgEnum("outbox_status", [
  "pending",
  "processing",
  "done",
  "failed",
]);

/**
 * Penomoran dokumen. Baris dibuat saat pertama dipakai pada suatu periode (upsert),
 * lalu nomor diambil secara atomik: UPDATE ... SET next_no = next_no + 1 RETURNING.
 * period_key: '' = tanpa reset, 'YYYY' (yearly) atau 'YYYYMM' (monthly).
 * branch_id NULL = penomoran satu untuk seluruh perusahaan.
 */
export const numberingSequences = pgTable(
  "numbering_sequences",
  {
    id: primaryId(),
    docType: text().notNull(),
    branchId: uuid().references(() => branches.id),
    periodKey: text().notNull().default(""),
    prefix: text().notNull(),
    padding: smallint().notNull().default(5),
    resetPolicy: numberingResetPolicyEnum().notNull().default("yearly"),
    nextNo: bigint({ mode: "number" }).notNull().default(1),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("numbering_sequences_global_uq")
      .on(t.docType, t.periodKey)
      .where(sql`${t.branchId} is null`),
    uniqueIndex("numbering_sequences_branch_uq")
      .on(t.docType, t.branchId, t.periodKey)
      .where(sql`${t.branchId} is not null`),
    check("numbering_sequences_next_chk", sql`${t.nextNo} >= 1`),
    check("numbering_sequences_padding_chk", sql`${t.padding} between 1 and 12`),
  ],
);

/** Definisi alur persetujuan per jenis dokumen, opsional dengan rentang nilai dan cabang. */
export const approvalWorkflows = pgTable(
  "approval_workflows",
  {
    id: primaryId(),
    docType: text().notNull(),
    name: text().notNull(),
    branchId: uuid().references(() => branches.id),
    minAmount: numeric({ precision: 18, scale: 2 }),
    maxAmount: numeric({ precision: 18, scale: 2 }),
    isActive: boolean().notNull().default(true),
    ...timestamps(),
    ...actorColumns(),
  },
  (t) => [
    index("approval_workflows_doc_type_idx").on(t.docType, t.isActive),
    check(
      "approval_workflows_amount_chk",
      sql`${t.minAmount} is null or ${t.maxAmount} is null or ${t.minAmount} <= ${t.maxAmount}`,
    ),
  ],
);

/** Setiap langkah ditujukan ke tepat satu: role ATAU user tertentu. */
export const approvalWorkflowSteps = pgTable(
  "approval_workflow_steps",
  {
    id: primaryId(),
    workflowId: uuid()
      .notNull()
      .references(() => approvalWorkflows.id, { onDelete: "cascade" }),
    stepNo: smallint().notNull(),
    approverRoleId: uuid().references(() => roles.id),
    approverUserId: uuid().references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("approval_workflow_steps_no_uq").on(t.workflowId, t.stepNo),
    check("approval_workflow_steps_no_chk", sql`${t.stepNo} >= 1`),
    check(
      "approval_workflow_steps_approver_chk",
      sql`(${t.approverRoleId} is not null) <> (${t.approverUserId} is not null)`,
    ),
  ],
);

/** Instans persetujuan untuk sebuah dokumen. doc_type + doc_id adalah rujukan penelusuran. */
export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: primaryId(),
    docType: text().notNull(),
    docId: uuid().notNull(),
    workflowId: uuid()
      .notNull()
      .references(() => approvalWorkflows.id),
    status: approvalRequestStatusEnum().notNull().default("pending"),
    currentStep: smallint().notNull().default(1),
    amount: numeric({ precision: 18, scale: 2 }),
    requestedBy: uuid()
      .notNull()
      .references(() => users.id),
    requestedAt: timestamptz().notNull().defaultNow(),
    completedAt: timestamptz(),
    ...timestamps(),
  },
  (t) => [
    // Satu dokumen hanya boleh punya satu permintaan yang sedang berjalan.
    uniqueIndex("approval_requests_pending_uq")
      .on(t.docType, t.docId)
      .where(sql`${t.status} = 'pending'`),
    index("approval_requests_doc_idx").on(t.docType, t.docId),
    index("approval_requests_workflow_idx").on(t.workflowId),
    check("approval_requests_step_chk", sql`${t.currentStep} >= 1`),
  ],
);

export const approvalActions = pgTable(
  "approval_actions",
  {
    id: primaryId(),
    requestId: uuid()
      .notNull()
      .references(() => approvalRequests.id, { onDelete: "cascade" }),
    stepNo: smallint().notNull(),
    actorId: uuid()
      .notNull()
      .references(() => users.id),
    action: approvalActionTypeEnum().notNull(),
    note: text(),
    actedAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("approval_actions_step_actor_uq").on(t.requestId, t.stepNo, t.actorId),
    index("approval_actions_actor_idx").on(t.actorId),
  ],
);

/** Metadata berkas. Isi berkas ada di object storage (storage_key). */
export const attachments = pgTable(
  "attachments",
  {
    id: primaryId(),
    storageKey: text().notNull().unique(),
    fileName: text().notNull(),
    mimeType: text().notNull(),
    sizeBytes: bigint({ mode: "number" }).notNull(),
    sha256: text().notNull(),
    uploadedBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    check("attachments_size_chk", sql`${t.sizeBytes} >= 0`),
    check("attachments_sha256_chk", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const attachmentLinks = pgTable(
  "attachment_links",
  {
    id: primaryId(),
    attachmentId: uuid()
      .notNull()
      .references(() => attachments.id, { onDelete: "cascade" }),
    docType: text().notNull(),
    docId: uuid().notNull(),
    createdBy: uuid().references(() => users.id),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("attachment_links_uq").on(t.attachmentId, t.docType, t.docId),
    index("attachment_links_doc_idx").on(t.docType, t.docId),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: primaryId(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text().notNull(),
    title: text().notNull(),
    body: text(),
    payload: jsonb(),
    readAt: timestamptz(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    index("notifications_user_created_idx").on(t.userId, t.createdAt),
    index("notifications_unread_idx")
      .on(t.userId)
      .where(sql`${t.readAt} is null`),
  ],
);

/**
 * Log audit append-only (dijaga trigger di migrasi kustom).
 * PK (id, at) agar siap dipartisi per bulan di Tahap 10.
 * actor_id NULL = tindakan sistem. entity_id bertipe text karena tidak semua entitas ber-uuid.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid().notNull().defaultRandom(),
    at: timestamptz().notNull().defaultNow(),
    actorId: uuid().references(() => users.id),
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: text(),
    before: jsonb(),
    after: jsonb(),
    ip: inet(),
    userAgent: text(),
    requestId: text(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.at] }),
    index("audit_logs_entity_idx").on(t.entityType, t.entityId, t.at),
    index("audit_logs_actor_idx").on(t.actorId, t.at),
    index("audit_logs_at_idx").on(t.at),
  ],
);

/** Idempotensi level API/aksi. Kunci unik per (scope, key). Baris kedaluwarsa dibersihkan berkala. */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    scope: text().notNull(),
    key: text().notNull(),
    userId: uuid().references(() => users.id),
    requestHash: text().notNull(),
    status: idempotencyStatusEnum().notNull().default("in_progress"),
    responseStatus: smallint(),
    response: jsonb(),
    createdAt: timestamptz().notNull().defaultNow(),
    expiresAt: timestamptz().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.scope, t.key] }),
    index("idempotency_keys_expires_idx").on(t.expiresAt),
  ],
);

/** Outbox untuk efek samping eksternal yang diproses ulang dengan aman di luar transaksi bisnis. */
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: primaryId(),
    eventType: text().notNull(),
    aggregateType: text().notNull(),
    aggregateId: text().notNull(),
    payload: jsonb().notNull(),
    status: outboxStatusEnum().notNull().default("pending"),
    attempts: integer().notNull().default(0),
    availableAt: timestamptz().notNull().defaultNow(),
    lastError: text(),
    processedAt: timestamptz(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    index("outbox_events_pending_idx")
      .on(t.availableAt)
      .where(sql`${t.status} = 'pending'`),
    index("outbox_events_aggregate_idx").on(t.aggregateType, t.aggregateId),
    check("outbox_events_attempts_chk", sql`${t.attempts} >= 0`),
  ],
);