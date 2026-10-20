import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { employees, payrollRunItemComponents, payrollRunItems, payslips } from "@/db/schema";
import { assertCan, inTx, type Reader, type Tx } from "@/modules/payroll/_refs";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { businessRule, notFound } from "@/server/errors";
import { nextDocumentNumber } from "@/server/numbering";
import type { AuthContext } from "@/server/authz";

const columns = {
  id: payslips.id,
  docNo: payslips.docNo,
  runItemId: payslips.runItemId,
  employeeId: payslips.employeeId,
  employeeCode: employees.code,
  employeeName: sql<string>`trim(coalesce(${employees.firstName}, '') || ' ' || coalesce(${employees.lastName}, ''))`,
  periodLabel: payslips.periodLabel,
  grossEarnings: payslips.grossEarnings,
  totalDeductions: payslips.totalDeductions,
  netPay: payslips.netPay,
  status: payslips.status,
  issuedAt: payslips.issuedAt,
  reason: payslips.reason,
};

async function requirePayslip(reader: Reader, id: string) {
  const [row] = await reader
    .select(columns)
    .from(payslips)
    .innerJoin(employees, eq(employees.id, payslips.employeeId))
    .where(eq(payslips.id, id))
    .limit(1);
  if (!row) throw notFound("Slip gaji tidak ditemukan.");
  return row;
}

/**
 * Terbitkan slip gaji untuk SELURUH item run (dipanggil dari postRun dalam tx yang sama).
 * Idempoten terhadap runItemId yang sudah punya slip. Snapshot menyimpan rincian baris
 * komponen agar slip tetap terbaca meski master berubah.
 */
export async function issuePayslipsForRun(
  tx: Tx,
  actor: AuthContext,
  runId: string,
  periodLabel: string,
  periodEnd: string,
) {
  const items = await tx
    .select({
      id: payrollRunItems.id,
      employeeId: payrollRunItems.employeeId,
      grossEarnings: payrollRunItems.grossEarnings,
      totalDeductions: payrollRunItems.totalDeductions,
      netPay: payrollRunItems.netPay,
    })
    .from(payrollRunItems)
    .where(eq(payrollRunItems.runId, runId));
  if (items.length === 0) return;

  const existing = await tx
    .select({ runItemId: payslips.runItemId })
    .from(payslips)
    .where(inArray(payslips.runItemId, items.map((i) => i.id)));
  const done = new Set(existing.map((e) => e.runItemId));

  // Rincian baris per item untuk snapshot.
  const lines = await tx
    .select({
      runItemId: payrollRunItemComponents.runItemId,
      label: payrollRunItemComponents.label,
      kind: payrollRunItemComponents.kind,
      amount: payrollRunItemComponents.amount,
      basisSnapshot: payrollRunItemComponents.basisSnapshot,
    })
    .from(payrollRunItemComponents)
    .where(inArray(payrollRunItemComponents.runItemId, items.map((i) => i.id)))
    .orderBy(asc(payrollRunItemComponents.id));
  const linesByItem = new Map<string, typeof lines>();
  for (const l of lines) {
    const list = linesByItem.get(l.runItemId) ?? [];
    list.push(l);
    linesByItem.set(l.runItemId, list);
  }

  for (const item of items) {
    if (done.has(item.id)) continue;
    const docNo = await nextDocumentNumber(tx, "payslip", { date: periodEnd });
    const detail = linesByItem.get(item.id) ?? [];
    const snapshot = {
      periodLabel,
      earnings: detail.filter((l) => l.kind === "earning").map((l) => ({ label: l.label, amount: l.amount })),
      deductions: detail
        .filter((l) => l.kind === "deduction" && (l.basisSnapshot as { party?: string } | null)?.party !== "employer")
        .map((l) => ({ label: l.label, amount: l.amount })),
      employerCosts: detail
        .filter((l) => (l.basisSnapshot as { party?: string } | null)?.party === "employer")
        .map((l) => ({ label: l.label, amount: l.amount })),
    };
    const [created] = await tx
      .insert(payslips)
      .values({
        docNo,
        runItemId: item.id,
        employeeId: item.employeeId,
        periodLabel,
        grossEarnings: item.grossEarnings,
        totalDeductions: item.totalDeductions,
        netPay: item.netPay,
        snapshot,
        status: "issued",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: payslips.id });
    if (!created) throw new Error("Gagal menerbitkan slip gaji.");
    await audit.log(
      { action: "payroll.payslip.issue", entityType: "payslip", entityId: created.id, actorId: actor.userId, after: { docNo, runItemId: item.id, netPay: item.netPay } },
      tx,
    );
  }
}

export async function voidPayslipsForRun(tx: Tx, actor: AuthContext, runId: string, reason: string) {
  const items = await tx
    .select({ id: payrollRunItems.id })
    .from(payrollRunItems)
    .where(eq(payrollRunItems.runId, runId));
  if (items.length === 0) return;
  await tx
    .update(payslips)
    .set({ status: "void", reason, updatedBy: actor.userId, updatedAt: new Date() })
    .where(and(inArray(payslips.runItemId, items.map((i) => i.id)), eq(payslips.status, "issued")));
}

/* ------------------------------ Baca ------------------------------ */

export async function listPayslips(
  actor: AuthContext,
  query: { employeeId?: string } = {},
  externalTx?: Tx,
) {
  assertCan(actor, "payroll.payslips.read");
  const reader = externalTx ?? db;
  return reader
    .select(columns)
    .from(payslips)
    .innerJoin(employees, eq(employees.id, payslips.employeeId))
    .where(query.employeeId === undefined ? undefined : eq(payslips.employeeId, query.employeeId))
    .orderBy(desc(payslips.issuedAt), asc(payslips.docNo));
}

export async function getPayslip(actor: AuthContext, id: string, externalTx?: Tx) {
  assertCan(actor, "payroll.payslips.read");
  return requirePayslip(externalTx ?? db, id);
}

/** Batalkan slip issued (status -> void). Slip void bukan bagian jurnal; hanya catatan. */
export async function voidPayslip(actor: AuthContext, id: string, reason: string, externalTx?: Tx) {
  assertCan(actor, "payroll.payslips.read");
  return inTx(externalTx, async (tx) => {
    const slip = await requirePayslip(tx, id);
    if (slip.status !== "issued") throw businessRule("Hanya slip berstatus issued yang dapat dibatalkan.");
    await tx
      .update(payslips)
      .set({ status: "void", reason, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(payslips.id, id));
    await audit.log(
      { action: "payroll.payslip.void", entityType: "payslip", entityId: id, actorId: actor.userId, after: { status: "void", reason } },
      tx,
    );
    return requirePayslip(tx, id);
  });
}
