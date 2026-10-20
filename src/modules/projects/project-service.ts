import { and, asc, eq, sql } from "drizzle-orm";

import {
  costCenters,
  employees,
  projectTasks,
  projects,
  type ProjectStatus,
} from "@/db/schema";
import { createCostCenter } from "@/modules/accounting/cost-center-service";
import type { CreateProjectInput, UpdateProjectInput, UpdateProgressInput } from "@/modules/projects/schemas";
import {
  assertCan,
  inTx,
  lockProject,
  requireActiveEmployee,
  requireLinkableCostCenter,
  type Reader,
  type Tx,
} from "@/modules/projects/_refs";
import { audit } from "@/server/audit";
import { cmp, div, toDb } from "@/lib/money";
import { db } from "@/server/db";
import { businessRule, conflict } from "@/server/errors";
import { nextDocumentNumber } from "@/server/numbering";
import type { AuthContext } from "@/server/authz";

const columns = {
  id: projects.id,
  code: projects.code,
  projectNumber: projects.projectNumber,
  name: projects.name,
  description: projects.description,
  costCenterId: projects.costCenterId,
  branchId: projects.branchId,
  managerEmployeeId: projects.managerEmployeeId,
  startDate: projects.startDate,
  endDate: projects.endDate,
  totalBudget: projects.totalBudget,
  progressPercent: projects.progressPercent,
  status: projects.status,
  isActive: projects.isActive,
  createdAt: projects.createdAt,
  updatedAt: projects.updatedAt,
};

/** Proyek + kode/nama cost center + nama penanggung jawab. */
async function projectWithRefs(reader: Reader, id: string) {
  const [row] = await reader
    .select({
      ...columns,
      costCenterCode: costCenters.code,
      costCenterName: costCenters.name,
      managerName: sql<string | null>`(nullif(trim(${employees.firstName}), '') || ' ' || coalesce(${employees.lastName}, ''))`,
    })
    .from(projects)
    .innerJoin(costCenters, eq(costCenters.id, projects.costCenterId))
    .leftJoin(employees, eq(employees.id, projects.managerEmployeeId))
    .where(eq(projects.id, id))
    .limit(1);
  if (!row) throw conflict("Proyek tidak ditemukan.");
  return row;
}

/* ------------------------------ Baca ------------------------------ */

export async function listProjects(
  actor: AuthContext,
  query: { status?: ProjectStatus; branchId?: string; isActive?: boolean } = {},
  externalTx?: Tx,
) {
  assertCan(actor, "projects.master.read");
  const reader: Reader = externalTx ?? db;
  return reader
    .select({ ...columns, costCenterCode: costCenters.code })
    .from(projects)
    .innerJoin(costCenters, eq(costCenters.id, projects.costCenterId))
    .where(
      and(
        query.status ? eq(projects.status, query.status) : undefined,
        query.branchId ? eq(projects.branchId, query.branchId) : undefined,
        query.isActive === undefined ? undefined : eq(projects.isActive, query.isActive),
      ),
    )
    .orderBy(asc(projects.code));
}

export async function getProject(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "projects.master.read");
  return projectWithRefs(externalTx ?? db, id);
}

/* ------------------------------ Tulis ------------------------------ */

/**
 * Buat proyek + tautan cost center 1:1. Bila `costCenterId` kosong, service
 * membuat cost center baru berkode sama dengan kode proyek lewat
 * cost-center-service (memakai izin cost center aktor yang sama).
 * `projectNumber` diambil dari aturan numbering `project` (PRJ).
 */
export async function createProject(actor: AuthContext, input: CreateProjectInput, externalTx?: Tx) {
  assertCan(actor, "projects.master.manage");
  return inTx(externalTx, async (tx) => {
    const [existing] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.code, input.code))
      .limit(1);
    if (existing) throw conflict("Kode proyek sudah dipakai.");

    if (input.endDate && input.endDate < input.startDate) {
      throw businessRule("Tanggal selesai tidak boleh sebelum tanggal mulai.");
    }
    if (input.managerEmployeeId) {
      await requireActiveEmployee(tx, input.managerEmployeeId, "Manager proyek");
    }

    const costCenterId = input.costCenterId
      ? (await requireLinkableCostCenter(tx, input.costCenterId)).id
      : (
          await createCostCenter(actor, {
            code: input.code,
            name: input.name,
            branchId: input.branchId ?? null,
            description: `Pusat biaya proyek ${input.code}`,
          }, tx)
        ).id;

    const projectNumber = await nextDocumentNumber(tx, "project", { date: input.startDate });

    const [created] = await tx
      .insert(projects)
      .values({
        code: input.code,
        projectNumber,
        name: input.name,
        description: input.description ?? null,
        costCenterId,
        branchId: input.branchId ?? null,
        managerEmployeeId: input.managerEmployeeId ?? null,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        totalBudget: input.totalBudget ?? null,
        status: input.status,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: projects.id });
    if (!created) throw new Error("Gagal membuat proyek.");

    await audit.log(
      {
        action: "projects.project.create",
        entityType: "project",
        entityId: created.id,
        actorId: actor.userId,
        after: { code: input.code, name: input.name, costCenterId, projectNumber },
      },
      tx,
    );
    return projectWithRefs(tx, created.id);
  });
}

export async function updateProject(
  actor: AuthContext,
  id: string,
  input: UpdateProjectInput,
  externalTx?: Tx,
) {
  assertCan(actor, "projects.master.manage");
  return inTx(externalTx, async (tx) => {
    const current = await lockProject(tx, id);
    const next = {
      name: input.name ?? current.name,
      description: input.description === undefined ? current.description : input.description,
      branchId: input.branchId === undefined ? current.branchId : input.branchId,
      managerEmployeeId:
        input.managerEmployeeId === undefined ? current.managerEmployeeId : input.managerEmployeeId,
      startDate: input.startDate ?? current.startDate,
      endDate: input.endDate === undefined ? current.endDate : input.endDate,
      totalBudget: input.totalBudget === undefined ? current.totalBudget : input.totalBudget,
      status: input.status ?? current.status,
      isActive: input.isActive ?? current.isActive,
    };
    if (next.endDate && next.endDate < next.startDate) {
      throw businessRule("Tanggal selesai tidak boleh sebelum tanggal mulai.");
    }
    if (input.managerEmployeeId) {
      await requireActiveEmployee(tx, input.managerEmployeeId, "Manager proyek");
    }

    await tx
      .update(projects)
      .set({ ...next, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(projects.id, id));
    await audit.log(
      {
        action: "projects.project.update",
        entityType: "project",
        entityId: id,
        actorId: actor.userId,
        before: { name: current.name, status: current.status, totalBudget: current.totalBudget },
        after: { name: next.name, status: next.status, totalBudget: next.totalBudget },
      },
      tx,
    );
    return projectWithRefs(tx, id);
  });
}

/* ----------------------------- Progres ---------------------------- */

/**
 * Progres otomatis: rata-rata berbobot tugas selesai (tugas cancelled dikeluarkan
 * dari pembagi). 0 bila tidak ada tugas aktif.
 */
async function computeAutoProgress(tx: Tx, projectId: string): Promise<string> {
  const [agg] = await tx
    .select({
      totalWeight: sql<string>`coalesce(sum(case when ${projectTasks.status} <> 'cancelled' then ${projectTasks.weightPercent} else 0 end), 0)::numeric(18,4)`,
      doneWeight: sql<string>`coalesce(sum(case when ${projectTasks.status} = 'completed' then ${projectTasks.weightPercent} else 0 end), 0)::numeric(18,4)`,
    })
    .from(projectTasks)
    .where(eq(projectTasks.projectId, projectId));
  const total = agg?.totalWeight ?? "0";
  const done = agg?.doneWeight ?? "0";
  if (cmp(total, "0") <= 0) return "0.0000";
  return toDb(div(done, total).times(100), 4);
}

/** Perbarui progres: nilai eksplisit (0..100) ATAU dihitung dari bobot tugas. */
export async function updateProgress(
  actor: AuthContext,
  id: string,
  input: UpdateProgressInput,
  externalTx?: Tx,
) {
  assertCan(actor, "projects.progress.manage");
  return inTx(externalTx, async (tx) => {
    await lockProject(tx, id);
    const source = input.progressPercent !== undefined ? "manual" : "auto";
    const percent = input.progressPercent ?? (await computeAutoProgress(tx, id));
    if (cmp(percent, "0") < 0 || cmp(percent, "100") > 0) {
      throw businessRule("Progres harus berada antara 0 dan 100.");
    }
    await tx
      .update(projects)
      .set({ progressPercent: toDb(percent, 4), updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(projects.id, id));
    await audit.log(
      {
        action: "projects.project.progress",
        entityType: "project",
        entityId: id,
        actorId: actor.userId,
        after: { progressPercent: toDb(percent, 4), source },
      },
      tx,
    );
    return { id, progressPercent: toDb(percent, 4), source };
  });
}
