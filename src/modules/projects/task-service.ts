import { asc, eq } from "drizzle-orm";

import { employees, projectMilestones, projectTasks } from "@/db/schema";
import type {
  CreateMilestoneInput,
  CreateTaskInput,
  UpdateMilestoneInput,
  UpdateTaskInput,
} from "@/modules/projects/schemas";
import {
  assertCan,
  inTx,
  requireActiveEmployee,
  requireProject,
  type Reader,
  type Tx,
} from "@/modules/projects/_refs";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { businessRule, notFound } from "@/server/errors";
import type { AuthContext } from "@/server/authz";

const taskColumns = {
  id: projectTasks.id,
  projectId: projectTasks.projectId,
  name: projectTasks.name,
  assigneeEmployeeId: projectTasks.assigneeEmployeeId,
  status: projectTasks.status,
  sortOrder: projectTasks.sortOrder,
  weightPercent: projectTasks.weightPercent,
  dueDate: projectTasks.dueDate,
  completedAt: projectTasks.completedAt,
  notes: projectTasks.notes,
  createdAt: projectTasks.createdAt,
  updatedAt: projectTasks.updatedAt,
};

const milestoneColumns = {
  id: projectMilestones.id,
  projectId: projectMilestones.projectId,
  name: projectMilestones.name,
  dueDate: projectMilestones.dueDate,
  isCompleted: projectMilestones.isCompleted,
  completedAt: projectMilestones.completedAt,
  notes: projectMilestones.notes,
  createdAt: projectMilestones.createdAt,
  updatedAt: projectMilestones.updatedAt,
};

async function taskWithAssignee(reader: Reader, id: string) {
  const [row] = await reader
    .select({ ...taskColumns, assigneeName: employees.firstName, assigneeCode: employees.code })
    .from(projectTasks)
    .leftJoin(employees, eq(employees.id, projectTasks.assigneeEmployeeId))
    .where(eq(projectTasks.id, id))
    .limit(1);
  if (!row) throw notFound("Tugas proyek tidak ditemukan.");
  return row;
}

async function milestoneRow(reader: Reader, id: string) {
  const [row] = await reader
    .select(milestoneColumns)
    .from(projectMilestones)
    .where(eq(projectMilestones.id, id))
    .limit(1);
  if (!row) throw notFound("Milestone proyek tidak ditemukan.");
  return row;
}

/** Guard: proyek cancelled/completed tidak menerima perubahan isi lagi. */
function assertProjectEditable(status: string) {
  if (status === "cancelled" || status === "completed") {
    throw businessRule(`Proyek berstatus ${status} tidak dapat diubah isinya.`);
  }
}

/* ------------------------------ Tugas ------------------------------ */

export async function listTasks(actor: AuthContext, projectId: string, externalTx?: Tx) {
  assertCan(actor, "projects.tasks.read");
  const reader: Reader = externalTx ?? db;
  await requireProject(reader, projectId);
  return reader
    .select({ ...taskColumns, assigneeName: employees.firstName, assigneeCode: employees.code })
    .from(projectTasks)
    .leftJoin(employees, eq(employees.id, projectTasks.assigneeEmployeeId))
    .where(eq(projectTasks.projectId, projectId))
    .orderBy(asc(projectTasks.sortOrder), asc(projectTasks.createdAt));
}

export async function createTask(actor: AuthContext, projectId: string, input: CreateTaskInput, externalTx?: Tx) {
  assertCan(actor, "projects.tasks.manage");
  return inTx(externalTx, async (tx) => {
    const project = await requireProject(tx, projectId);
    assertProjectEditable(project.status);
    if (input.assigneeEmployeeId) {
      await requireActiveEmployee(tx, input.assigneeEmployeeId, "Penanggung jawab tugas");
    }
    const [created] = await tx
      .insert(projectTasks)
      .values({
        projectId,
        name: input.name,
        assigneeEmployeeId: input.assigneeEmployeeId ?? null,
        status: "pending",
        sortOrder: input.sortOrder,
        weightPercent: input.weightPercent,
        dueDate: input.dueDate ?? null,
        notes: input.notes ?? null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: projectTasks.id });
    if (!created) throw new Error("Gagal membuat tugas.");
    await audit.log(
      { action: "projects.task.create", entityType: "project_task", entityId: created.id, actorId: actor.userId, after: { projectId, name: input.name } },
      tx,
    );
    return taskWithAssignee(tx, created.id);
  });
}

/**
 * Ubah tugas. Transisi status ditegakkan: `completed` wajib mengisi
 * `completedAt` (check DB); membuka kembali tugas selesai menghapus stempel.
 */
export async function updateTask(actor: AuthContext, id: string, input: UpdateTaskInput, externalTx?: Tx) {
  assertCan(actor, "projects.tasks.manage");
  return inTx(externalTx, async (tx) => {
    const [current] = await tx
      .select()
      .from(projectTasks)
      .where(eq(projectTasks.id, id))
      .limit(1);
    if (!current) throw notFound("Tugas proyek tidak ditemukan.");
    const nextStatus = input.status ?? current.status;
    const next = {
      name: input.name ?? current.name,
      assigneeEmployeeId:
        input.assigneeEmployeeId === undefined ? current.assigneeEmployeeId : input.assigneeEmployeeId,
      status: nextStatus,
      sortOrder: input.sortOrder ?? current.sortOrder,
      weightPercent: input.weightPercent ?? current.weightPercent,
      dueDate: input.dueDate === undefined ? current.dueDate : input.dueDate,
      notes: input.notes === undefined ? current.notes : input.notes,
      completedAt:
        nextStatus === "completed"
          ? (current.completedAt ?? new Date())
          : null,
    };
    if (next.assigneeEmployeeId) {
      await requireActiveEmployee(tx, next.assigneeEmployeeId, "Penanggung jawab tugas");
    }
    await tx
      .update(projectTasks)
      .set({ ...next, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(projectTasks.id, id));
    await audit.log(
      { action: "projects.task.update", entityType: "project_task", entityId: id, actorId: actor.userId, before: { status: current.status }, after: { status: nextStatus } },
      tx,
    );
    return taskWithAssignee(tx, id);
  });
}

/* ---------------------------- Milestone ---------------------------- */

export async function listMilestones(actor: AuthContext, projectId: string, externalTx?: Tx) {
  assertCan(actor, "projects.tasks.read");
  const reader: Reader = externalTx ?? db;
  await requireProject(reader, projectId);
  return reader
    .select(milestoneColumns)
    .from(projectMilestones)
    .where(eq(projectMilestones.projectId, projectId))
    .orderBy(asc(projectMilestones.dueDate));
}

export async function createMilestone(
  actor: AuthContext,
  projectId: string,
  input: CreateMilestoneInput,
  externalTx?: Tx,
) {
  assertCan(actor, "projects.tasks.manage");
  return inTx(externalTx, async (tx) => {
    const project = await requireProject(tx, projectId);
    assertProjectEditable(project.status);
    const [created] = await tx
      .insert(projectMilestones)
      .values({
        projectId,
        name: input.name,
        dueDate: input.dueDate ?? null,
        notes: input.notes ?? null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: projectMilestones.id });
    if (!created) throw new Error("Gagal membuat milestone.");
    await audit.log(
      { action: "projects.milestone.create", entityType: "project_milestone", entityId: created.id, actorId: actor.userId, after: { projectId, name: input.name } },
      tx,
    );
    return milestoneRow(tx, created.id);
  });
}

export async function updateMilestone(
  actor: AuthContext,
  id: string,
  input: UpdateMilestoneInput,
  externalTx?: Tx,
) {
  assertCan(actor, "projects.tasks.manage");
  return inTx(externalTx, async (tx) => {
    const current = await milestoneRow(tx, id);
    const nextCompleted = input.isCompleted ?? current.isCompleted;
    const next = {
      name: input.name ?? current.name,
      dueDate: input.dueDate === undefined ? current.dueDate : input.dueDate,
      isCompleted: nextCompleted,
      completedAt: nextCompleted ? (current.completedAt ?? new Date()) : null,
      notes: input.notes === undefined ? current.notes : input.notes,
    };
    await tx
      .update(projectMilestones)
      .set({ ...next, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(projectMilestones.id, id));
    await audit.log(
      { action: "projects.milestone.update", entityType: "project_milestone", entityId: id, actorId: actor.userId, after: { isCompleted: next.isCompleted } },
      tx,
    );
    return milestoneRow(tx, id);
  });
}
