import { and, asc, eq } from "drizzle-orm";

import { trainingEnrollments, trainingPrograms } from "@/db/schema";
import type {
  CreateEnrollmentInput,
  CreateTrainingProgramInput,
  UpdateEnrollmentInput,
  UpdateTrainingProgramInput,
} from "@/modules/hr/schemas";
import { assertCan, requireActiveEmployee } from "@/modules/hr/_refs";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { conflict, notFound, validationFailed } from "@/server/errors";
import type { AuthContext } from "@/server/authz";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const programColumns = {
  id: trainingPrograms.id,
  code: trainingPrograms.code,
  name: trainingPrograms.name,
  provider: trainingPrograms.provider,
  isActive: trainingPrograms.isActive,
};

const enrollmentColumns = {
  id: trainingEnrollments.id,
  programId: trainingEnrollments.programId,
  employeeId: trainingEnrollments.employeeId,
  status: trainingEnrollments.status,
  completedAt: trainingEnrollments.completedAt,
};

async function requireProgram(reader: Tx | typeof db, id: string) {
  const [row] = await reader.select(programColumns).from(trainingPrograms).where(eq(trainingPrograms.id, id)).limit(1);
  if (!row) throw notFound("Program pelatihan tidak ditemukan.");
  return row;
}

async function requireEnrollment(reader: Tx | typeof db, id: string) {
  const [row] = await reader.select(enrollmentColumns).from(trainingEnrollments).where(eq(trainingEnrollments.id, id)).limit(1);
  if (!row) throw notFound("Pendaftaran pelatihan tidak ditemukan.");
  return row;
}

/* ---------------------------- Program ----------------------------- */

export async function listPrograms(actor: AuthContext, externalTx?: Tx) {
  assertCan(actor, "hr.training.read");
  return (externalTx ?? db).select(programColumns).from(trainingPrograms).orderBy(asc(trainingPrograms.code));
}

export async function createProgram(actor: AuthContext, input: CreateTrainingProgramInput, externalTx?: Tx) {
  assertCan(actor, "hr.training.manage");
  const run = async (tx: Tx) => {
    const [existing] = await tx.select({ id: trainingPrograms.id }).from(trainingPrograms).where(eq(trainingPrograms.code, input.code)).limit(1);
    if (existing) throw conflict("Kode program pelatihan sudah dipakai.");
    const values = { code: input.code, name: input.name, provider: input.provider ?? null };
    const [created] = await tx
      .insert(trainingPrograms)
      .values({ ...values, isActive: true, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: trainingPrograms.id });
    if (!created) throw new Error("Gagal membuat program pelatihan.");
    await audit.log({ action: "hr.training_program.create", entityType: "training_program", entityId: created.id, actorId: actor.userId, after: values }, tx);
    return requireProgram(tx, created.id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function updateProgram(actor: AuthContext, id: string, input: UpdateTrainingProgramInput, externalTx?: Tx) {
  assertCan(actor, "hr.training.manage");
  const run = async (tx: Tx) => {
    const current = await requireProgram(tx, id);
    const next = {
      name: input.name ?? current.name,
      provider: input.provider === undefined ? current.provider : input.provider,
      isActive: input.isActive ?? current.isActive,
    };
    await tx.update(trainingPrograms).set({ ...next, updatedBy: actor.userId, updatedAt: new Date() }).where(eq(trainingPrograms.id, id));
    await audit.log({ action: "hr.training_program.update", entityType: "training_program", entityId: id, actorId: actor.userId, after: next }, tx);
    return requireProgram(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

/* -------------------------- Pendaftaran --------------------------- */

export async function listEnrollments(actor: AuthContext, programId: string | undefined, externalTx?: Tx) {
  assertCan(actor, "hr.training.read");
  const reader = externalTx ?? db;
  const base = reader.select(enrollmentColumns).from(trainingEnrollments);
  const q = programId ? base.where(eq(trainingEnrollments.programId, programId)) : base;
  return q.orderBy(asc(trainingEnrollments.employeeId));
}

export async function createEnrollment(actor: AuthContext, input: CreateEnrollmentInput, externalTx?: Tx) {
  assertCan(actor, "hr.training.manage");
  const run = async (tx: Tx) => {
    const program = await requireProgram(tx, input.programId);
    if (!program.isActive) throw validationFailed([{ path: "programId", message: "Program pelatihan tidak aktif." }]);
    await requireActiveEmployee(tx, input.employeeId);

    const [existing] = await tx
      .select({ id: trainingEnrollments.id })
      .from(trainingEnrollments)
      .where(and(eq(trainingEnrollments.programId, input.programId), eq(trainingEnrollments.employeeId, input.employeeId)))
      .limit(1);
    if (existing) throw conflict("Karyawan sudah terdaftar pada program ini.");

    const values = { programId: input.programId, employeeId: input.employeeId, status: input.status ?? "enrolled" };
    const [created] = await tx
      .insert(trainingEnrollments)
      .values({ ...values, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: trainingEnrollments.id });
    if (!created) throw new Error("Gagal mendaftarkan pelatihan.");
    await audit.log({ action: "hr.training_enrollment.create", entityType: "training_enrollment", entityId: created.id, actorId: actor.userId, after: values }, tx);
    return requireEnrollment(tx, created.id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function updateEnrollment(actor: AuthContext, id: string, input: UpdateEnrollmentInput, externalTx?: Tx) {
  assertCan(actor, "hr.training.manage");
  const run = async (tx: Tx) => {
    const current = await requireEnrollment(tx, id);
    const next = {
      status: input.status ?? current.status,
      completedAt: input.completedAt === undefined ? current.completedAt : input.completedAt ? new Date(input.completedAt) : null,
    };
    await tx.update(trainingEnrollments).set({ ...next, updatedBy: actor.userId, updatedAt: new Date() }).where(eq(trainingEnrollments.id, id));
    await audit.log({ action: "hr.training_enrollment.update", entityType: "training_enrollment", entityId: id, actorId: actor.userId, after: { status: next.status } }, tx);
    return requireEnrollment(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}
