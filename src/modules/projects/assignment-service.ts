import { and, asc, eq } from "drizzle-orm";

import { employees, projectAssignments } from "@/db/schema";
import type { CreateAssignmentInput } from "@/modules/projects/schemas";
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
import { conflict, notFound } from "@/server/errors";
import type { AuthContext } from "@/server/authz";

const columns = {
  id: projectAssignments.id,
  projectId: projectAssignments.projectId,
  employeeId: projectAssignments.employeeId,
  role: projectAssignments.role,
  createdAt: projectAssignments.createdAt,
  updatedAt: projectAssignments.updatedAt,
};

async function rowWithEmployee(reader: Reader, id: string) {
  const [row] = await reader
    .select({ ...columns, employeeCode: employees.code, employeeName: employees.firstName })
    .from(projectAssignments)
    .innerJoin(employees, eq(employees.id, projectAssignments.employeeId))
    .where(eq(projectAssignments.id, id))
    .limit(1);
  if (!row) throw notFound("Penugasan proyek tidak ditemukan.");
  return row;
}

export async function listAssignments(actor: AuthContext, projectId: string, externalTx?: Tx) {
  assertCan(actor, "projects.master.read");
  const reader: Reader = externalTx ?? db;
  await requireProject(reader, projectId);
  return reader
    .select({ ...columns, employeeCode: employees.code, employeeName: employees.firstName })
    .from(projectAssignments)
    .innerJoin(employees, eq(employees.id, projectAssignments.employeeId))
    .where(eq(projectAssignments.projectId, projectId))
    .orderBy(asc(employees.code));
}

export async function createAssignment(
  actor: AuthContext,
  projectId: string,
  input: CreateAssignmentInput,
  externalTx?: Tx,
) {
  assertCan(actor, "projects.assignments.manage");
  return inTx(externalTx, async (tx) => {
    await requireProject(tx, projectId);
    await requireActiveEmployee(tx, input.employeeId, "Karyawan");
    const [duplicate] = await tx
      .select({ id: projectAssignments.id })
      .from(projectAssignments)
      .where(
        and(
          eq(projectAssignments.projectId, projectId),
          eq(projectAssignments.employeeId, input.employeeId),
        ),
      )
      .limit(1);
    if (duplicate) throw conflict("Karyawan sudah ditugaskan pada proyek ini.");

    const [created] = await tx
      .insert(projectAssignments)
      .values({
        projectId,
        employeeId: input.employeeId,
        role: input.role,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: projectAssignments.id });
    if (!created) throw new Error("Gagal membuat penugasan.");
    await audit.log(
      { action: "projects.assignment.create", entityType: "project_assignment", entityId: created.id, actorId: actor.userId, after: { projectId, employeeId: input.employeeId, role: input.role } },
      tx,
    );
    return rowWithEmployee(tx, created.id);
  });
}

/** Hapus penugasan (baris taut non-finansial; jejak tetap di audit log). */
export async function removeAssignment(actor: AuthContext, projectId: string, id: string, externalTx?: Tx) {
  assertCan(actor, "projects.assignments.manage");
  return inTx(externalTx, async (tx) => {
    const row = await rowWithEmployee(tx, id);
    if (row.projectId !== projectId) throw notFound("Penugasan tidak berada di bawah proyek ini.");
    await tx.delete(projectAssignments).where(eq(projectAssignments.id, id));
    await audit.log(
      { action: "projects.assignment.remove", entityType: "project_assignment", entityId: id, actorId: actor.userId, before: { projectId: row.projectId, employeeId: row.employeeId, role: row.role } },
      tx,
    );
    return { id, removed: true };
  });
}
