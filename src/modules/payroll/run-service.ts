import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import {
  employeeCompensations,
  employees,
  payrollAdjustments,
  payrollComponentValues,
  payrollRunItemComponents,
  payrollRunItems,
  payrollRuns,
  salaryComponents,
  salaryStructureComponents,
  statutoryRules,
} from "@/db/schema";
import type { CreateRunInput, ListRunsQuery } from "@/modules/payroll/schemas";
import {
  computeEmployeePay,
  type ComponentValueInput,
  type EmployeePayInput,
  type EmployeePayResult,
} from "@/modules/payroll/calculation";
import { buildPayrollJournalLines, type PayrollJournalAggregate } from "@/modules/payroll/journal-builder";
import { assertCan, inTx, lockRun, requirePeriod, requireRun, type Reader, type Tx } from "@/modules/payroll/_refs";
import { loadEffectiveStatutoryRules } from "@/modules/payroll/statutory-service";
import { issuePayslipsForRun, voidPayslipsForRun } from "@/modules/payroll/payslip-service";
import { markPeriodPosted } from "@/modules/payroll/period-service";
import { createSystemDraft, postJournal, reverseJournal } from "@/modules/accounting/journal-service";
import {
  resolveOtherDeductionAccountId,
  resolvePayrollAccountIds,
} from "@/modules/payroll/payroll-account-config";
import { add, cmp, toDb } from "@/lib/money";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { businessRule } from "@/server/errors";
import { nextDocumentNumber } from "@/server/numbering";
import type { AuthContext } from "@/server/authz";

/** sourceType jurnal akrual payroll (Tahap 7E). */
const SOURCE_PAYROLL = "payroll_run";

const plus = (a: string, b: string) => toDb(add(a, b));

const runColumns = {
  id: payrollRuns.id,
  docNo: payrollRuns.docNo,
  periodId: payrollRuns.periodId,
  branchId: payrollRuns.branchId,
  status: payrollRuns.status,
  employeeCount: payrollRuns.employeeCount,
  totalEarnings: payrollRuns.totalEarnings,
  totalDeductions: payrollRuns.totalDeductions,
  totalNet: payrollRuns.totalNet,
  journalEntryId: payrollRuns.journalEntryId,
  payableJournalEntryId: payrollRuns.payableJournalEntryId,
  calculatedBy: payrollRuns.calculatedBy,
  approvedBy: payrollRuns.approvedBy,
  postedAt: payrollRuns.postedAt,
  cancelledAt: payrollRuns.cancelledAt,
  reversedAt: payrollRuns.reversedAt,
  reason: payrollRuns.reason,
  createdAt: payrollRuns.createdAt,
  updatedAt: payrollRuns.updatedAt,
};

async function loadItems(reader: Reader, runId: string) {
  return reader
    .select({
      id: payrollRunItems.id,
      runId: payrollRunItems.runId,
      employeeId: payrollRunItems.employeeId,
      employeeCode: employees.code,
      employeeName: sql<string>`trim(coalesce(${employees.firstName}, '') || ' ' || coalesce(${employees.lastName}, ''))`,
      grossEarnings: payrollRunItems.grossEarnings,
      totalDeductions: payrollRunItems.totalDeductions,
      netPay: payrollRunItems.netPay,
    })
    .from(payrollRunItems)
    .innerJoin(employees, eq(employees.id, payrollRunItems.employeeId))
    .where(eq(payrollRunItems.runId, runId))
    .orderBy(asc(employees.code));
}

async function loadItemComponents(reader: Reader, runItemId: string) {
  return reader
    .select({
      id: payrollRunItemComponents.id,
      componentId: payrollRunItemComponents.componentId,
      statutoryRuleId: payrollRunItemComponents.statutoryRuleId,
      label: payrollRunItemComponents.label,
      kind: payrollRunItemComponents.kind,
      amount: payrollRunItemComponents.amount,
      basisSnapshot: payrollRunItemComponents.basisSnapshot,
    })
    .from(payrollRunItemComponents)
    .where(eq(payrollRunItemComponents.runItemId, runItemId))
    .orderBy(asc(payrollRunItemComponents.id));
}

async function withDetails(reader: Reader, id: string) {
  const run = await requireRun(reader, id);
  const items = await loadItems(reader, id);
  const detailed = await Promise.all(
    items.map(async (it) => ({ ...it, components: await loadItemComponents(reader, it.id) })),
  );
  return { ...run, items: detailed };
}

/* ------------------------------ Baca ------------------------------ */

export async function listRuns(actor: AuthContext, query: ListRunsQuery = {}, externalTx?: Tx) {
  assertCan(actor, "payroll.runs.read");
  const reader = externalTx ?? db;
  return reader
    .select(runColumns)
    .from(payrollRuns)
    .where(
      and(
        query.periodId === undefined ? undefined : eq(payrollRuns.periodId, query.periodId),
        query.status === undefined ? undefined : eq(payrollRuns.status, query.status),
      ),
    )
    .orderBy(desc(payrollRuns.createdAt));
}

export async function getRun(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "payroll.runs.read");
  return withDetails(externalTx ?? db, id);
}

/* ------------------------------ Buat run --------------------------- */

export async function createRun(actor: AuthContext, input: CreateRunInput, externalTx?: Tx) {
  assertCan(actor, "payroll.runs.manage");
  return inTx(externalTx, async (tx) => {
    const period = await requirePeriod(tx, input.periodId);
    if (period.status !== "finalized" && period.status !== "posted") {
      throw businessRule("Periode payroll harus berstatus finalized/posted untuk membuat run.");
    }

    // Satu run aktif per (periode, cabang).
    const branchCond =
      input.branchId == null ? isNull(payrollRuns.branchId) : eq(payrollRuns.branchId, input.branchId);
    const [existing] = await tx
      .select({ id: payrollRuns.id })
      .from(payrollRuns)
      .where(
        and(
          eq(payrollRuns.periodId, input.periodId),
          inArray(payrollRuns.status, ["draft", "calculated", "approved", "posted"]),
          branchCond,
        ),
      )
      .limit(1);
    if (existing) throw businessRule("Sudah ada run aktif untuk periode/cabang ini.");

    const [created] = await tx
      .insert(payrollRuns)
      .values({
        periodId: input.periodId,
        branchId: input.branchId ?? period.branchId ?? null,
        status: "draft",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: payrollRuns.id });
    if (!created) throw new Error("Gagal membuat run payroll.");
    await audit.log(
      {
        action: "payroll.run.create",
        entityType: "payroll_run",
        entityId: created.id,
        actorId: actor.userId,
        after: { periodId: input.periodId, branchId: input.branchId ?? null },
      },
      tx,
    );
    return withDetails(tx, created.id);
  });
}

/* ---------------------------- Kalkulasi ---------------------------- */

export async function calculateRun(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "payroll.runs.manage");
  return inTx(externalTx, async (tx) => {
    const run = await lockRun(tx, id);
    if (run.status !== "draft" && run.status !== "calculated") {
      throw businessRule("Hanya run berstatus draft/calculated yang dapat dihitung ulang.");
    }
    const period = await requirePeriod(tx, run.periodId);
    if (period.status === "closed") throw businessRule("Periode sudah ditutup; tidak dapat menghitung.");

    const rules = await loadEffectiveStatutoryRules(tx, period.periodEnd);
    const inputs = await gatherInputs(tx, run, period.periodEnd);

    const results: EmployeePayResult[] = inputs.map((emp) =>
      computeEmployeePay({ ...emp, rules }),
    );

    // Reset item (cascade anak) lalu tulis hasil kalkulasi.
    await tx.delete(payrollRunItems).where(eq(payrollRunItems.runId, id));

    let totalEarnings = "0.00";
    let totalDeductions = "0.00";
    let totalNet = "0.00";
    for (const r of results) {
      const [item] = await tx
        .insert(payrollRunItems)
        .values({
          runId: id,
          employeeId: r.employeeId,
          grossEarnings: r.grossEarnings,
          totalDeductions: r.totalDeductions,
          netPay: r.netPay,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        })
        .returning({ id: payrollRunItems.id });
      if (!item) throw new Error("Gagal menyimpan item run.");
      const lines = [...r.earnings, ...r.deductions, ...r.employerCosts];
      if (lines.length > 0) {
        await tx.insert(payrollRunItemComponents).values(
          lines.map((line) => ({
            runItemId: item.id,
            componentId: line.componentId ?? null,
            statutoryRuleId: line.statutoryRuleId ?? null,
            label: line.label,
            kind: line.kind,
            amount: line.amount,
            basisSnapshot: line.basisSnapshot ?? null,
            createdBy: actor.userId,
            updatedBy: actor.userId,
          })),
        );
      }
      totalEarnings = plus(totalEarnings, r.grossEarnings);
      totalDeductions = plus(totalDeductions, r.totalDeductions);
      totalNet = plus(totalNet, r.netPay);
    }

    await tx
      .update(payrollRuns)
      .set({
        status: "calculated",
        employeeCount: results.length,
        totalEarnings,
        totalDeductions,
        totalNet,
        calculatedBy: actor.userId,
        updatedBy: actor.userId,
        updatedAt: new Date(),
      })
      .where(eq(payrollRuns.id, id));
    await audit.log(
      {
        action: "payroll.run.calculate",
        entityType: "payroll_run",
        entityId: id,
        actorId: actor.userId,
        after: { employeeCount: results.length, totalEarnings, totalDeductions, totalNet },
      },
      tx,
    );
    return withDetails(tx, id);
  });
}

/* ---------------------------- Approve (SoD) ------------------------ */

/**
 * calculated -> approved. Pemisahan tugas (SoD): penyetuju bukan pembuat run dan
 * bukan yang menghitung. (Mesin persetujuan 3J tersedia, namun — mengikuti seluruh
 * modul dokumen lain — transisi status dilakukan di service dengan guard eksplisit.)
 */
export async function approveRun(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "payroll.runs.post");
  return inTx(externalTx, async (tx) => {
    const run = await lockRun(tx, id);
    if (run.status !== "calculated") throw businessRule("Hanya run berstatus calculated yang dapat disetujui.");
    if (run.createdBy === actor.userId) throw businessRule("Pembuat run tidak dapat menyetujuinya sendiri.");
    if (run.calculatedBy === actor.userId) throw businessRule("Yang menghitung run tidak dapat menyetujuinya.");
    if (run.employeeCount <= 0) throw businessRule("Run tanpa karyawan tidak dapat disetujui.");

    await tx
      .update(payrollRuns)
      .set({ status: "approved", approvedBy: actor.userId, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(payrollRuns.id, id));
    await audit.log(
      { action: "payroll.run.approve", entityType: "payroll_run", entityId: id, actorId: actor.userId, after: { status: "approved" } },
      tx,
    );
    return withDetails(tx, id);
  });
}

/* ----------------------------- Post ------------------------------- */

export async function postRun(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "payroll.runs.post");
  return inTx(externalTx, async (tx) => {
    const run = await lockRun(tx, id);
    if (run.status !== "approved") throw businessRule("Hanya run berstatus approved yang dapat diposting.");
    const period = await requirePeriod(tx, run.periodId);
    if (period.status === "closed") throw businessRule("Periode sudah ditutup; tidak dapat memposting.");

    const agg = await aggregateFromRun(tx, id);
    if (cmp(agg.grossEarnings, "0") <= 0) throw businessRule("Total penghasilan run nol; tidak dapat diposting.");

    const accounts = await resolvePayrollAccountIds(tx);
    const otherAccountId = await resolveOtherDeductionAccountId(tx, cmp(agg.otherDeduction, "0") > 0);
    const lines = buildPayrollJournalLines(accounts, otherAccountId, agg);

    const draft = await createSystemDraft(tx, actor, {
      entryDate: period.periodEnd,
      description: `Jurnal payroll run ${run.docNo ?? run.id} (${period.name})`,
      lines,
      sourceType: SOURCE_PAYROLL,
      sourceId: run.id,
      sourceEvent: "post",
      idempotencyKey: `payroll_run_post:${run.id}`,
    });
    const posted = await postJournal(actor, draft.id, tx);

    const docNo = await nextDocumentNumber(tx, "payroll_run", {
      date: period.periodEnd,
      branchId: run.branchId ?? undefined,
    });

    await tx
      .update(payrollRuns)
      .set({
        status: "posted",
        docNo,
        journalEntryId: posted.id,
        postedAt: new Date(),
        updatedBy: actor.userId,
        updatedAt: new Date(),
      })
      .where(eq(payrollRuns.id, id));

    await issuePayslipsForRun(tx, actor, id, period.name, period.periodEnd);
    await markPeriodPosted(tx, actor, run.periodId);

    await audit.log(
      { action: "payroll.run.post", entityType: "payroll_run", entityId: id, actorId: actor.userId, after: { status: "posted", docNo, journalEntryId: posted.id } },
      tx,
    );
    return withDetails(tx, id);
  });
}

/* ---------------------------- Cancel ------------------------------ */

export async function cancelRun(actor: AuthContext, id: string, reason: string, externalTx?: Tx) {
  assertCan(actor, "payroll.runs.manage");
  return inTx(externalTx, async (tx) => {
    const run = await lockRun(tx, id);
    if (run.status !== "draft" && run.status !== "calculated") {
      throw businessRule("Hanya run draft/calculated yang dapat dibatalkan. Gunakan reversal untuk run posted.");
    }
    await tx
      .update(payrollRuns)
      .set({ status: "cancelled", reason, cancelledAt: new Date(), updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(payrollRuns.id, id));
    await audit.log(
      { action: "payroll.run.cancel", entityType: "payroll_run", entityId: id, actorId: actor.userId, after: { status: "cancelled", reason } },
      tx,
    );
    return withDetails(tx, id);
  });
}

/* ---------------------------- Reverse ----------------------------- */

export async function reverseRun(actor: AuthContext, id: string, reason: string, externalTx?: Tx) {
  assertCan(actor, "payroll.runs.post");
  return inTx(externalTx, async (tx) => {
    const run = await lockRun(tx, id);
    if (run.status !== "posted") throw businessRule("Hanya run berstatus posted yang dapat dibalik.");
    if (!run.journalEntryId) throw businessRule("Run posted tanpa jurnal terkait; tidak dapat dibalik.");

    await reverseJournal(actor, run.journalEntryId, { reason }, tx);
    await voidPayslipsForRun(tx, actor, id, reason);

    await tx
      .update(payrollRuns)
      .set({ status: "reversed", reason, reversedAt: new Date(), updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(payrollRuns.id, id));
    await audit.log(
      { action: "payroll.run.reverse", entityType: "payroll_run", entityId: id, actorId: actor.userId, after: { status: "reversed", reason } },
      tx,
    );
    return withDetails(tx, id);
  });
}

/* ------------------------ Agregasi jurnal -------------------------- */

type DedBasis = { party?: string };

/**
 * Klasifikasi baris komponen yang tersimpan (sumber kebenaran = hasil engine) untuk
 * kebutuhan jurnal. Totals penghasilan/potongan/net diambil dari item (authoritative);
 * rincian PPh21/BPJS/lain + biaya pemberi kerja dipetakan dari baris deduction.
 */
async function aggregateFromRun(tx: Tx, runId: string): Promise<PayrollJournalAggregate> {
  const items = await tx
    .select({
      id: payrollRunItems.id,
      gross: payrollRunItems.grossEarnings,
      ded: payrollRunItems.totalDeductions,
      net: payrollRunItems.netPay,
    })
    .from(payrollRunItems)
    .where(eq(payrollRunItems.runId, runId));
  if (items.length === 0) {
    throw businessRule("Run tidak memiliki item untuk diposting.");
  }
  const itemIds = items.map((i) => i.id);

  const dedRows = await tx
    .select({
      amount: payrollRunItemComponents.amount,
      basis: payrollRunItemComponents.basisSnapshot,
      ruleKind: statutoryRules.kind,
    })
    .from(payrollRunItemComponents)
    .leftJoin(statutoryRules, eq(statutoryRules.id, payrollRunItemComponents.statutoryRuleId))
    .where(and(inArray(payrollRunItemComponents.runItemId, itemIds), eq(payrollRunItemComponents.kind, "deduction")));

  let tax = "0.00";
  let bpjsEmployee = "0.00";
  let bpjsEmployer = "0.00";
  let otherDeduction = "0.00";
  for (const d of dedRows) {
    const party = (d.basis as DedBasis | null)?.party;
    if (party === "employer") {
      bpjsEmployer = plus(bpjsEmployer, d.amount);
      continue;
    }
    if (d.ruleKind === "pph21") tax = plus(tax, d.amount);
    else if (d.ruleKind != null && d.ruleKind.startsWith("bpjs_")) bpjsEmployee = plus(bpjsEmployee, d.amount);
    else otherDeduction = plus(otherDeduction, d.amount);
  }

  return {
    grossEarnings: items.reduce((a, i) => plus(a, i.gross), "0.00"),
    totalDeductions: items.reduce((a, i) => plus(a, i.ded), "0.00"),
    netPay: items.reduce((a, i) => plus(a, i.net), "0.00"),
    tax,
    bpjsEmployee,
    bpjsEmployer,
    otherDeduction,
  };
}

/* ---------------------- Pengumpulan input engine ------------------- */

type EmpInput = Omit<EmployeePayInput, "rules">;

async function gatherInputs(
  tx: Tx,
  run: { branchId: string | null; periodId: string },
  asOf: string,
): Promise<EmpInput[]> {
  const empRows = await tx
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.isActive, true), run.branchId ? eq(employees.branchId, run.branchId) : undefined));
  if (empRows.length === 0) return [];
  const empIds = empRows.map((e) => e.id);

  // Gaji pokok terbaru yang berlaku <= asOf per karyawan (asc -> overwrite = terbaru).
  const compRows = await tx
    .select({
      employeeId: employeeCompensations.employeeId,
      structureId: employeeCompensations.structureId,
      baseSalary: employeeCompensations.baseSalary,
    })
    .from(employeeCompensations)
    .where(and(inArray(employeeCompensations.employeeId, empIds), lte(employeeCompensations.effectiveFrom, asOf)))
    .orderBy(asc(employeeCompensations.effectiveFrom));
  const compByEmp = new Map<string, (typeof compRows)[number]>();
  for (const c of compRows) compByEmp.set(c.employeeId, c);

  // Nilai komponen efektif (latest per employee+component <= asOf) + metadata komponen.
  const valRows = await tx
    .select({
      employeeId: payrollComponentValues.employeeId,
      componentId: payrollComponentValues.componentId,
      amount: payrollComponentValues.amount,
      percentValue: payrollComponentValues.percentValue,
      code: salaryComponents.code,
      name: salaryComponents.name,
      kind: salaryComponents.kind,
      basis: salaryComponents.basis,
      includeInTaxBase: salaryComponents.includeInTaxBase,
      includeInBpjsBase: salaryComponents.includeInBpjsBase,
      compActive: salaryComponents.isActive,
    })
    .from(payrollComponentValues)
    .innerJoin(salaryComponents, eq(salaryComponents.id, payrollComponentValues.componentId))
    .where(and(inArray(payrollComponentValues.employeeId, empIds), lte(payrollComponentValues.effectiveFrom, asOf)))
    .orderBy(asc(payrollComponentValues.effectiveFrom));
  const valByEmp = new Map<string, Map<string, (typeof valRows)[number]>>();
  for (const v of valRows) {
    if (!v.compActive) continue;
    const m = valByEmp.get(v.employeeId) ?? new Map();
    m.set(v.componentId, v); // asc -> overwrite = terbaru per komponen
    valByEmp.set(v.employeeId, m);
  }

  // Keanggotaan struktur (membatasi komponen yang dipakai bila struktur ditetapkan).
  const structureIds = [...new Set([...compByEmp.values()].map((c) => c.structureId).filter((s): s is string => !!s))];
  const membersByStructure = new Map<string, Set<string>>();
  if (structureIds.length > 0) {
    const members = await tx
      .select({ structureId: salaryStructureComponents.structureId, componentId: salaryStructureComponents.componentId })
      .from(salaryStructureComponents)
      .where(inArray(salaryStructureComponents.structureId, structureIds));
    for (const m of members) {
      const set = membersByStructure.get(m.structureId) ?? new Set();
      set.add(m.componentId);
      membersByStructure.set(m.structureId, set);
    }
  }

  // Penyesuaian aktif: spesifik periode run ATAU berulang (periodId null), <= asOf.
  const adjRows = await tx
    .select({
      employeeId: payrollAdjustments.employeeId,
      kind: payrollAdjustments.kind,
      amount: payrollAdjustments.amount,
      notes: payrollAdjustments.notes,
    })
    .from(payrollAdjustments)
    .where(
      and(
        inArray(payrollAdjustments.employeeId, empIds),
        eq(payrollAdjustments.isActive, true),
        lte(payrollAdjustments.effectiveFrom, asOf),
        or(eq(payrollAdjustments.periodId, run.periodId), isNull(payrollAdjustments.periodId)),
      ),
    );
  const adjByEmp = new Map<string, (typeof adjRows)[number][]>();
  for (const a of adjRows) {
    const list = adjByEmp.get(a.employeeId) ?? [];
    list.push(a);
    adjByEmp.set(a.employeeId, list);
  }

  const inputs: EmpInput[] = [];
  for (const empId of empIds) {
    const comp = compByEmp.get(empId);
    if (!comp) continue; // tanpa gaji pokok -> tidak masuk run
    const valueMap = valByEmp.get(empId);
    const allowed = comp.structureId ? membersByStructure.get(comp.structureId) : null;
    const components: ComponentValueInput[] = valueMap
      ? [...valueMap.values()]
          .filter((v) => (allowed ? allowed.has(v.componentId) : true))
          .map((v) => ({
            componentId: v.componentId,
            code: v.code,
            name: v.name,
            kind: v.kind,
            basis: v.basis,
            amount: v.amount,
            percentValue: v.percentValue,
            includeInTaxBase: v.includeInTaxBase,
            includeInBpjsBase: v.includeInBpjsBase,
          }))
      : [];
    const adjustments = (adjByEmp.get(empId) ?? []).map((a) => ({
      kind: a.kind,
      amount: a.amount,
      label:
        a.notes && a.notes.trim()
          ? a.notes
          : a.kind === "earning"
            ? "Penyesuaian penghasilan"
            : "Penyesuaian potongan",
    }));
    inputs.push({ employeeId: empId, baseSalary: comp.baseSalary, components, adjustments });
  }
  return inputs;
}
