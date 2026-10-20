import { sql } from "drizzle-orm";

import { users } from "@/db/schema";
import { createPosition, getPosition, listPosition, updatePosition } from "@/modules/hr/position-service";
import { createEmployee, getEmployee, listEmployees, unlinkEmployeeUser, updateEmployee } from "@/modules/hr/employee-service";
import { createDocument, deleteDocument, getDocument, listDocuments, updateDocument } from "@/modules/hr/document-service";
import { createContract, getContract, listContracts, updateContract } from "@/modules/hr/contract-service";
import { createShift, getShift, listShifts, updateShift } from "@/modules/hr/shift-service";
import { listAttendance, recordAttendance } from "@/modules/hr/attendance-service";
import {
  approveLeaveRequest,
  createLeaveRequest,
  createLeaveType,
  listLeaveBalances,
  setLeaveBalance,
  submitLeaveRequest,
  updateLeaveType,
} from "@/modules/hr/leave-service";
import { approveOvertime, createOvertime, listOvertime, submitOvertime } from "@/modules/hr/overtime-service";
import { createEvaluation, listEvaluations, updateEvaluation } from "@/modules/hr/evaluation-service";
import {
  createEnrollment,
  createProgram,
  listEnrollments,
  listPrograms,
  updateEnrollment,
  updateProgram,
} from "@/modules/hr/training-service";
import { getMyAttendance, getMyLeave, getMyOvertime, getMyProfile } from "@/modules/hr/self-service";
import { loadGrants, type AuthContext } from "@/server/authz";
import { db } from "@/server/db";

/**
 * Skrip uji Tahap 7C: CRUD penuh modul HR + self-service.
 * Seluruh operasi dalam SATU db.transaction dengan throw Rollback — TIDAK ADA data tersimpan.
 * BUTUH migrasi 0024 (tabel HR).
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

class Rollback extends Error {}

let passed = 0;
function assert(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "GAGAL"}: ${label}`);
  if (!ok) throw new Error(`Aseri gagal: ${label}`);
  passed += 1;
}

async function expectError(label: string, tx: Tx, expectedCode: string, fn: () => Promise<unknown>) {
  await tx.execute(sql`savepoint sp_err`);
  try {
    await fn();
    await tx.execute(sql`release savepoint sp_err`);
    assert(`${label} (seharusnya ${expectedCode})`, false);
  } catch (error) {
    await tx.execute(sql`rollback to savepoint sp_err`);
    const e = error as { code?: string };
    assert(`${label} = ${expectedCode}`, e.code === expectedCode);
  }
}

async function main() {
  const [u] = await db.select({ id: users.id }).from(users).limit(1);
  if (!u) throw new Error("Belum ada pengguna.");

  const actor: AuthContext = { userId: u.id, name: "Uji", email: "uji@example.com", grants: await loadGrants(u.id) };
  const noGrants: AuthContext = { ...actor, grants: [] };
  const fake = "00000000-0000-4000-8000-000000000000";

  try {
    await db.transaction(async (tx) => {
      /* -------- Positions -------- */
      const pos = await createPosition(actor, { code: "TST-POS", name: "Analis Uji" }, tx);
      assert("createPosition id", !!pos.id);
      await expectError("duplikat position", tx, "CONFLICT", () =>
        createPosition(actor, { code: "TST-POS", name: "Lain" }, tx),
      );
      const posUpd = await updatePosition(actor, pos.id, { name: "Analis Senior" }, tx);
      assert("updatePosition name", posUpd.name === "Analis Senior");
      assert("getPosition cocok", (await getPosition(actor, pos.id, tx)).id === pos.id);
      assert("listPosition >= 1", (await listPosition(actor, {}, tx)).length >= 1);
      await expectError("position tanpa izin", tx, "FORBIDDEN", () => createPosition(noGrants, { code: "NOPE", name: "Nope" }, tx));

      /* -------- Employees (+link user) -------- */
      const empA = await createEmployee(actor, { code: "TST-EMPA", userId: u.id, firstName: "Andi", email: null, dateJoined: "2025-01-01", positionId: pos.id, status: "active" }, tx);
      assert("createEmployee A id", !!empA.id);
      assert("createEmployee A linked", empA.userId === u.id);
      const empB = await createEmployee(actor, { code: "TST-EMPB", firstName: "Binti", lastName: "Cahaya", email: null, dateJoined: "2025-02-01" }, tx);
      assert("createEmployee B id", !!empB.id);
      await expectError("duplikat employee code", tx, "CONFLICT", () =>
        createEmployee(actor, { code: "TST-EMPA", firstName: "Dobel", email: null, dateJoined: "2025-01-01" }, tx),
      );
      const empUpd = await updateEmployee(actor, empB.id, { status: "on_leave", email: null }, tx);
      assert("updateEmployee status", empUpd.status === "on_leave");
      assert("getEmployee cocok", (await getEmployee(actor, empA.id, tx)).id === empA.id);
      assert("listEmployees >= 2", (await listEmployees(actor, {}, tx)).length >= 2);
      await expectError("getEmployee tidak ada", tx, "NOT_FOUND", () => getEmployee(actor, fake, tx));

      /* -------- Documents -------- */
      const doc = await createDocument(actor, { employeeId: empA.id, category: "identity", name: "KTP Andi" }, tx);
      assert("createDocument id", !!doc.id);
      const docUpd = await updateDocument(actor, doc.id, { name: "KTP Andi (baru)" }, tx);
      assert("updateDocument name", docUpd.name === "KTP Andi (baru)");
      assert("listDocuments >= 1", (await listDocuments(actor, empA.id, tx)).length >= 1);
      await deleteDocument(actor, doc.id, tx);
      await expectError("getDocument setelah hapus", tx, "NOT_FOUND", () => getDocument(actor, doc.id, tx));

      /* -------- Contracts -------- */
      const ctr = await createContract(actor, { employeeId: empA.id, code: "TST-KTR", type: "pkwtt", startDate: "2025-01-01", status: "active" }, tx);
      assert("createContract id", !!ctr.id);
      assert("createContract docNo terisi", typeof ctr.docNo === "string" && ctr.docNo.startsWith("KTR-"));
      await expectError("duplikat contract code", tx, "CONFLICT", () =>
        createContract(actor, { employeeId: empB.id, code: "TST-KTR", type: "pkwt", startDate: "2025-01-01" }, tx),
      );
      await expectError("contract tanggal terbalik", tx, "VALIDATION_FAILED", () =>
        createContract(actor, { employeeId: empB.id, code: "TST-KTR2", type: "pkwt", startDate: "2025-06-01", endDate: "2025-05-01" }, tx),
      );
      const ctrUpd = await updateContract(actor, ctr.id, { status: "ended" }, tx);
      assert("updateContract status", ctrUpd.status === "ended");
      assert("listContracts >= 1", (await listContracts(actor, empA.id, tx)).length >= 1);
      assert("getContract cocok", (await getContract(actor, ctr.id, tx)).id === ctr.id);

      /* -------- Shifts -------- */
      const shift = await createShift(actor, { code: "TST-SH", name: "Reguler Pagi", workStart: "08:00", workEnd: "16:00" }, tx);
      assert("createShift id", !!shift.id);
      await expectError("duplikat shift code", tx, "CONFLICT", () => createShift(actor, { code: "TST-SH", name: "Lain" }, tx));
      const shiftUpd = await updateShift(actor, shift.id, { workEnd: "17:00" }, tx);
      assert("updateShift workEnd", shiftUpd.workEnd === "17:00:00");
      assert("getShift cocok", (await getShift(actor, shift.id, tx)).id === shift.id);
      assert("listShifts >= 1", (await listShifts(actor, tx)).length >= 1);

      /* -------- Attendance (upsert employee+date) -------- */
      const att = await recordAttendance(actor, { employeeId: empA.id, workDate: "2026-03-02", shiftId: shift.id, status: "present", overtimeMinutes: 60 }, tx);
      assert("recordAttendance id", !!att.id);
      const attAgain = await recordAttendance(actor, { employeeId: empA.id, workDate: "2026-03-02", shiftId: shift.id, status: "late" }, tx);
      assert("upsert absensi id sama", attAgain.id === att.id);
      assert("upsert absensi status berubah", attAgain.status === "late");
      const attB = await recordAttendance(actor, { employeeId: empB.id, workDate: "2026-03-02", status: "present" }, tx);
      assert("listAttendance A >= 1", (await listAttendance(actor, { employeeId: empA.id }, tx)).length >= 1);

      /* -------- Leave: type + balance + request (approve memotong saldo) -------- */
      const lt = await createLeaveType(actor, { code: "TST-LT", name: "Cuti Tahunan", paid: true }, tx);
      assert("createLeaveType id", !!lt.id);
      await expectError("duplikat leaveType code", tx, "CONFLICT", () => createLeaveType(actor, { code: "TST-LT", name: "Lain" }, tx));
      await updateLeaveType(actor, lt.id, { defaultQuotaDays: "12" }, tx);

      await setLeaveBalance(actor, { employeeId: empA.id, leaveTypeId: lt.id, year: 2026, totalDays: "12" }, tx);
      const [bal0] = await listLeaveBalances(actor, empA.id, tx);
      assert("setLeaveBalance totalDays", bal0?.totalDays === "12.00");
      assert("setLeaveBalance usedDays awal", bal0?.usedDays === "0.00");

      const lv = await createLeaveRequest(actor, { employeeId: empA.id, leaveTypeId: lt.id, startDate: "2026-03-10", endDate: "2026-03-12", days: "3" }, tx);
      assert("createLeaveRequest docNo", typeof lv.docNo === "string" && lv.docNo.startsWith("CVT-"));
      const lvSub = await submitLeaveRequest(actor, lv.id, tx);
      assert("submitLeaveRequest pending", lvSub.status === "pending");
      const lvApp = await approveLeaveRequest(actor, lv.id, {}, tx);
      assert("approveLeaveRequest approved", lvApp.status === "approved");
      const [balAfter] = await listLeaveBalances(actor, empA.id, tx);
      assert("approve memotong saldo usedDays", balAfter?.usedDays === "3.00");

      // request & lembur milik B (untuk uji isolasi self-service)
      await setLeaveBalance(actor, { employeeId: empB.id, leaveTypeId: lt.id, year: 2026, totalDays: "12" }, tx);
      const lvB = await createLeaveRequest(actor, { employeeId: empB.id, leaveTypeId: lt.id, startDate: "2026-03-10", endDate: "2026-03-10", days: "1" }, tx);

      // Saldo tidak cukup → BUSINESS_RULE
      const lvBig = await createLeaveRequest(actor, { employeeId: empA.id, leaveTypeId: lt.id, startDate: "2026-04-01", endDate: "2026-04-01", days: "100" }, tx);
      await submitLeaveRequest(actor, lvBig.id, tx);
      await expectError("approve saldo kurang", tx, "BUSINESS_RULE", () => approveLeaveRequest(actor, lvBig.id, {}, tx));
      await expectError("approve ganda", tx, "BUSINESS_RULE", () => approveLeaveRequest(actor, lv.id, {}, tx));

      /* -------- Overtime -------- */
      const ot = await createOvertime(actor, { employeeId: empA.id, workDate: "2026-03-05", startAt: "2026-03-05T18:00:00Z", endAt: "2026-03-05T20:00:00Z", hours: "2" }, tx);
      assert("createOvertime docNo", typeof ot.docNo === "string" && ot.docNo.startsWith("OTR-"));
      await expectError("overtime waktu terbalik", tx, "VALIDATION_FAILED", () =>
        createOvertime(actor, { employeeId: empA.id, workDate: "2026-03-06", startAt: "2026-03-06T20:00:00Z", endAt: "2026-03-06T18:00:00Z", hours: "2" }, tx),
      );
      const otSub = await submitOvertime(actor, ot.id, tx);
      assert("submitOvertime pending", otSub.status === "pending");
      const otApp = await approveOvertime(actor, ot.id, {}, tx);
      assert("approveOvertime approved", otApp.status === "approved");
      const otB = await createOvertime(actor, { employeeId: empB.id, workDate: "2026-03-05", startAt: "2026-03-05T18:00:00Z", endAt: "2026-03-05T19:00:00Z", hours: "1" }, tx);
      assert("listOvertime A >= 1", (await listOvertime(actor, empA.id, tx)).length >= 1);

      /* -------- Evaluations -------- */
      const ev = await createEvaluation(actor, { employeeId: empA.id, periodLabel: "2026-Q1", score: "88.50", rating: "Baik" }, tx);
      assert("createEvaluation id", !!ev.id);
      await expectError("duplikat evaluasi periode", tx, "CONFLICT", () =>
        createEvaluation(actor, { employeeId: empA.id, periodLabel: "2026-Q1" }, tx),
      );
      const evUpd = await updateEvaluation(actor, ev.id, { score: "90.00", status: "finalized" }, tx);
      assert("updateEvaluation status", evUpd.status === "finalized");
      assert("listEvaluations A >= 1", (await listEvaluations(actor, empA.id, tx)).length >= 1);

      /* -------- Training -------- */
      const prog = await createProgram(actor, { code: "TST-TR", name: "Pelatihan Keselamatan" }, tx);
      assert("createProgram id", !!prog.id);
      await expectError("duplikat program code", tx, "CONFLICT", () => createProgram(actor, { code: "TST-TR", name: "Lain" }, tx));
      await updateProgram(actor, prog.id, { provider: "Internal" }, tx);
      const enr = await createEnrollment(actor, { programId: prog.id, employeeId: empA.id }, tx);
      assert("createEnrollment id", !!enr.id);
      await expectError("duplikat enrollment", tx, "CONFLICT", () => createEnrollment(actor, { programId: prog.id, employeeId: empA.id }, tx));
      const enrUpd = await updateEnrollment(actor, enr.id, { status: "completed", completedAt: "2026-03-20T00:00:00Z" }, tx);
      assert("updateEnrollment completed", enrUpd.status === "completed");
      assert("listPrograms >= 1", (await listPrograms(actor, tx)).length >= 1);
      assert("listEnrollments >= 1", (await listEnrollments(actor, prog.id, tx)).length >= 1);

      /* -------- Self-service isolasi (hanya data karyawan tertaut user sesi) -------- */
      const me = await getMyProfile(actor, tx);
      assert("getMyProfile = karyawan A", me.id === empA.id);
      const myAtt = await getMyAttendance(actor, {}, tx);
      assert("getMyAttendance berisi absensi A", myAtt.some((r) => r.id === att.id));
      assert("getMyAttendance TIDAK berisi absensi B", !myAtt.some((r) => r.id === attB.id));
      const myLeave = await getMyLeave(actor, tx);
      assert("getMyLeave berisi saldo A", myLeave.balances.some((b) => b.totalDays === "12.00"));
      assert("getMyLeave berisi request A", myLeave.requests.some((r) => r.id === lv.id));
      assert("getMyLeave TIDAK berisi request B", !myLeave.requests.some((r) => r.id === lvB.id));
      const myOt = await getMyOvertime(actor, tx);
      assert("getMyOvertime berisi lembur A", myOt.some((r) => r.id === ot.id));
      assert("getMyOvertime TIDAK berisi lembur B", !myOt.some((r) => r.id === otB.id));
      await expectError("self-service tanpa izin", tx, "FORBIDDEN", () => getMyProfile(noGrants, tx));

      /* -------- Unlink user -------- */
      const unlinked = await unlinkEmployeeUser(actor, empA.id, tx);
      assert("unlinkEmployeeUser userId null", unlinked.userId === null);

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log(`[test-hr] rollback OK — ${passed} asersi PASS, tidak ada data tersimpan di DB.`);
    return;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[test-hr] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
