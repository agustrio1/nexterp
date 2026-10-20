import { asc, eq } from "drizzle-orm";

import { employmentContracts } from "@/db/schema";
import type { CreateContractInput, UpdateContractInput } from "@/modules/hr/schemas";
import { assertCan, requireActiveEmployee } from "@/modules/hr/_refs";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { conflict, notFound, validationFailed } from "@/server/errors";
import { nextDocumentNumber } from "@/server/numbering";
import type { AuthContext } from "@/server/authz";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const columns = {
  id: employmentContracts.id,
  docNo: employmentContracts.docNo,
  employeeId: employmentContracts.employeeId,
  code: employmentContracts.code,
  type: employmentContracts.type,
  startDate: employmentContracts.startDate,
  endDate: employmentContracts.endDate,
  status: employmentContracts.status,
  notes: employmentContracts.notes,
  createdAt: employmentContracts.createdAt,
  updatedAt: employmentContracts.updatedAt,
};

async function requireContract(reader: Tx | typeof db, id: string) {
  const [row] = await reader.select(columns).from(employmentContracts).where(eq(employmentContracts.id, id)).limit(1);
  if (!row) throw notFound("Kontrak tidak ditemukan.");
  return row;
}

export async function listContracts(actor: AuthContext, employeeId: string | undefined, externalTx?: Tx) {
  assertCan(actor, "hr.contracts.read");
  const reader = externalTx ?? db;
  const base = reader.select(columns).from(employmentContracts);
  const query = employeeId ? base.where(eq(employmentContracts.employeeId, employeeId)) : base;
  return query.orderBy(asc(employmentContracts.startDate));
}

export async function getContract(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "hr.contracts.read");
  return requireContract(externalTx ?? db, id);
}

export async function createContract(actor: AuthContext, input: CreateContractInput, externalTx?: Tx) {
  assertCan(actor, "hr.contracts.manage");
  const run = async (tx: Tx) => {
    const [existing] = await tx.select({ id: employmentContracts.id }).from(employmentContracts).where(eq(employmentContracts.code, input.code)).limit(1);
    if (existing) throw conflict("Kode kontrak sudah dipakai.");
    if (input.endDate && input.endDate < input.startDate) {
      throw validationFailed([{ path: "endDate", message: "Tanggal selesai tidak boleh sebelum tanggal mulai." }]);
    }
    await requireActiveEmployee(tx, input.employeeId);

    const docNo = await nextDocumentNumber(tx, "employment_contract", { date: input.startDate });
    const values = {
      docNo,
      employeeId: input.employeeId,
      code: input.code,
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      status: input.status ?? "draft",
      notes: input.notes ?? null,
    };
    const [created] = await tx
      .insert(employmentContracts)
      .values({ ...values, createdBy: actor.userId, updatedBy: actor.userId })
      .returning({ id: employmentContracts.id });
    if (!created) throw new Error("Gagal membuat kontrak.");
    await audit.log({ action: "hr.contract.create", entityType: "employment_contract", entityId: created.id, actorId: actor.userId, after: { code: values.code, docNo } }, tx);
    return requireContract(tx, created.id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}

export async function updateContract(actor: AuthContext, id: string, input: UpdateContractInput, externalTx?: Tx) {
  assertCan(actor, "hr.contracts.manage");
  const run = async (tx: Tx) => {
    const current = await requireContract(tx, id);
    const startDate = input.startDate ?? current.startDate;
    const endDate = input.endDate === undefined ? current.endDate : input.endDate;
    if (endDate && endDate < startDate) {
      throw validationFailed([{ path: "endDate", message: "Tanggal selesai tidak boleh sebelum tanggal mulai." }]);
    }
    const next = {
      type: input.type ?? current.type,
      startDate,
      endDate,
      status: input.status ?? current.status,
      notes: input.notes === undefined ? current.notes : input.notes,
    };
    await tx.update(employmentContracts).set({ ...next, updatedBy: actor.userId, updatedAt: new Date() }).where(eq(employmentContracts.id, id));
    await audit.log({ action: "hr.contract.update", entityType: "employment_contract", entityId: id, actorId: actor.userId, after: next }, tx);
    return requireContract(tx, id);
  };
  return externalTx ? run(externalTx) : db.transaction(run);
}
