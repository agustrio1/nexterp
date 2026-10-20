import { asc, desc, eq } from "drizzle-orm";

import { payslips } from "@/db/schema";
import { resolveOwnEmployee } from "@/modules/hr/_refs";
import { assertCan, type Reader, type Tx } from "@/modules/payroll/_refs";
import { db } from "@/server/db";
import type { AuthContext } from "@/server/authz";

/** Slip gaji milik karyawan yang tertaut akun sesi (read-only, self-service). */
export async function getMyPayslips(actor: AuthContext, externalTx?: Tx) {
  assertCan(actor, "payroll.self.payslip");
  const reader: Reader = externalTx ?? db;
  const me = await resolveOwnEmployee(reader, actor.userId);
  return reader
    .select({
      id: payslips.id,
      docNo: payslips.docNo,
      periodLabel: payslips.periodLabel,
      grossEarnings: payslips.grossEarnings,
      totalDeductions: payslips.totalDeductions,
      netPay: payslips.netPay,
      status: payslips.status,
      issuedAt: payslips.issuedAt,
      snapshot: payslips.snapshot,
    })
    .from(payslips)
    .where(eq(payslips.employeeId, me.id))
    .orderBy(desc(payslips.issuedAt), asc(payslips.docNo));
}
