import { and, eq } from "drizzle-orm";

import {
  accountingPeriods,
  chartAccounts,
  costCenters,
  employees,
  fiscalYears,
  users,
} from "@/db/schema";
import {
  createSystemDraft,
  postJournal,
  reverseJournal,
} from "@/modules/accounting/journal-service";
import { createCostCenter } from "@/modules/accounting/cost-center-service";
import { createFiscalYear } from "@/modules/organization/fiscal-service";
import { createProject, listProjects, updateProgress, updateProject } from "@/modules/projects/project-service";
import { createAssignment, removeAssignment } from "@/modules/projects/assignment-service";
import { createProjectBudget } from "@/modules/projects/budget-service";
import { createMilestone, updateMilestone, createTask, updateTask } from "@/modules/projects/task-service";
import { projectProfitability } from "@/modules/projects/report-service";
import { loadGrants, type AuthContext } from "@/server/authz";
import { db } from "@/server/db";

/**
 * Skrip uji Tahap 8C: alur proyek end-to-end (keputusan "proyek = cost center").
 * FY terisolasi (UJIFY2037); proyek dibuat mode auto (cost center anak otomatis)
 * dan mode taut; jurnal ber-tag costCenterId diposting lewat mesin jurnal inti;
 * profitabilitas & varian anggaran diajarkan PERSIS; guard 1:1 cc, SoD izin,
 * bobot progres otomatis, dan proyek tertutup ikut diuji. SELURUHNYA dalam SATU
 * transaksi dengan throw Rollback — TIDAK ADA data tersimpan di DB.
 * Catatan: sourceId jurnal wajib UUID (kolom uuid) — tag manusia di idempotencyKey.
 */

class Rollback extends Error {}

let passed = 0;
function assert(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "GAGAL"}: ${label}`);
  if (!ok) throw new Error(`Aseri gagal: ${label}`);
  passed += 1;
}

async function expectFail(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    assert(`${label} (harusnya ditolak)`, false);
  } catch {
    assert(`${label} ditolak`, true);
  }
}

async function main() {
  const [u] = await db.select({ id: users.id }).from(users).limit(1);
  if (!u) throw new Error("Belum ada pengguna (jalankan db:seed + db:create-admin).");

  const actorA: AuthContext = {
    userId: u.id,
    name: "Operator",
    email: "operator-uji@example.com",
    grants: await loadGrants(u.id),
  };

  try {
    await db.transaction(async (tx) => {
      /* ---------- Prasyarat: FY 2037 (12 periode bulanan open) ---------- */
      await createFiscalYear(
        actorA,
        { code: "UJIFY2037", startDate: "2037-01-01", endDate: "2037-12-31", includeAdjustmentPeriod: false },
        tx,
      );

      /* ---------- Akun GL uji ---------- */
      async function addAccount(code: string, name: string, type: "asset" | "expense" | "revenue") {
        const [row] = await tx
          .insert(chartAccounts)
          .values({ code, name, type, isPostable: true, isActive: true, createdBy: actorA.userId, updatedBy: actorA.userId })
          .returning({ id: chartAccounts.id });
        if (!row) throw new Error(`Gagal membuat akun uji ${code}`);
        return row.id;
      }
      const accBank = await addAccount("1920", "Bank Uji Proyek", "asset");
      const accExpense = await addAccount("5910", "Beban Proyek Uji", "expense");
      const accRevenue = await addAccount("4910", "Pendapatan Proyek Uji", "revenue");

      /* ---------- Karyawan uji (manager/penugasan) ---------- */
      const [emp] = await tx
        .insert(employees)
        .values({ code: "UJ-EMP-37", firstName: "Karyawan", lastName: "Uji", dateJoined: "2037-01-05", status: "active", isActive: true, createdBy: actorA.userId, updatedBy: actorA.userId })
        .returning({ id: employees.id });
      if (!emp) throw new Error("Gagal membuat karyawan uji.");

      /* ---------- Cost center untuk mode taut + cc nonaktif ---------- */
      const ccLink = await createCostCenter(
        actorA,
        { code: "UJ-CC-LINK", name: "CC Tautan Uji", branchId: null, description: "Untuk mode taut proyek" },
        tx,
      );
      const [ccInactive] = await tx
        .insert(costCenters)
        .values({ code: "UJ-CC-OFF", name: "CC Nonaktif Uji", isActive: false, createdBy: actorA.userId, updatedBy: actorA.userId })
        .returning({ id: costCenters.id });
      if (!ccInactive) throw new Error("Gagal membuat cc nonaktif uji.");

      /* ---------- Proyek 1: mode auto (cc anak dibuat otomatis) ---------- */
      const p1 = await createProject(
        actorA,
        { code: "UJP001", name: "Proyek Uji Satu", startDate: "2037-04-01", totalBudget: "10000000", status: "planning" },
        tx,
      );
      assert("proyek UJP001 dibuat dengan cc anak kode sama", p1.costCenterCode === "UJP001");
      assert("projectNumber dari aturan PRJ", p1.projectNumber !== null && p1.projectNumber.startsWith("PRJ"));
      assert("progres awal 0.0000", p1.progressPercent === "0.0000");

      await expectFail("kode proyek duplikat", () =>
        createProject(actorA, { code: "UJP001", name: "Proyek Kembar", startDate: "2037-04-01", status: "planning" }, tx),
      );
      await expectFail("taut cc nonaktif", () =>
        createProject(
          actorA,
          { code: "UJP00X", name: "Proyek CC Mati", startDate: "2037-04-01", costCenterId: ccInactive.id, status: "planning" },
          tx,
        ),
      );

      /* ---------- Proyek 2: mode taut cc yang ada ---------- */
      const p2 = await createProject(
        actorA,
        { code: "UJP002", name: "Proyek Uji Dua", startDate: "2037-04-01", costCenterId: ccLink.id, status: "planning" },
        tx,
      );
      assert("proyek UJP002 menaut cc link", p2.costCenterCode === "UJ-CC-LINK");
      await expectFail("cc sudah ditautkan proyek lain (1:1)", () =>
        createProject(
          actorA,
          { code: "UJP003", name: "Proyek CC Bentrok", startDate: "2037-04-01", costCenterId: ccLink.id, status: "planning" },
          tx,
        ),
      );

      /* ---------- Tugas + progres berbobot ---------- */
      const t1 = await createTask(actorA, p1.id, { name: "Tugas Satu", weightPercent: "60", sortOrder: 1 }, tx);
      await createTask(actorA, p1.id, { name: "Tugas Dua", weightPercent: "40", sortOrder: 2 }, tx);
      const t3 = await createTask(actorA, p1.id, { name: "Tugas Batal", weightPercent: "100", sortOrder: 3 }, tx);
      await updateTask(actorA, t3.id, { status: "cancelled" }, tx);
      await updateTask(actorA, t1.id, { status: "completed" }, tx);

      const auto1 = await updateProgress(actorA, p1.id, {}, tx);
      // Tugas cancelled (bobot 100) keluar dari pembagi -> 60 / (60+40) * 100 = 60.0000
      assert("auto progress 60/100 = 60.0000 (tugas batal dikecualikan)", auto1.source === "auto" && auto1.progressPercent === "60.0000");
      const manual = await updateProgress(actorA, p1.id, { progressPercent: "42.5" }, tx);
      assert("manual progress 42.5", manual.source === "manual" && manual.progressPercent === "42.5000");
      const auto2 = await updateProgress(actorA, p1.id, {}, tx);
      assert("auto menghitung ulang (mengatasi manual)", auto2.progressPercent === "60.0000");
      await expectFail("progres manual > 100", () => updateProgress(actorA, p1.id, { progressPercent: "120" }, tx));

      const completedTask = await updateTask(actorA, t1.id, {}, tx);
      assert("tugas completed mempertahankan completedAt", completedTask.status === "completed" && completedTask.completedAt !== null);

      /* ---------- Milestone ---------- */
      const ms = await createMilestone(actorA, p1.id, { name: "Milestone Serah Terima", dueDate: "2037-06-30" }, tx);
      const msDone = await updateMilestone(actorA, ms.id, { isCompleted: true }, tx);
      assert("milestone selesai men-stempel completedAt", msDone.isCompleted === true && msDone.completedAt !== null);

      /* ---------- Penugasan ---------- */
      const assignment = await createAssignment(actorA, p1.id, { employeeId: emp.id, role: "Developer" }, tx);
      assert("penugasan karyawan dibuat", assignment.employeeCode === "UJ-EMP-37");
      await expectFail("penugasan duplikat karyawan sama", () =>
        createAssignment(actorA, p1.id, { employeeId: emp.id, role: "QA" }, tx),
      );

      /* ---------- Anggaran proyek ---------- */
      const budgetAcc = await createProjectBudget(
        actorA, p1.id, { accountId: accExpense, periodKey: "2037-04", amount: "5000000" }, tx,
      );
      await createProjectBudget(actorA, p1.id, { amount: "8000000" }, tx);

      /* ---------- Jurnal ber-tag cc (posting via mesin jurnal inti) ---------- */
      const [period] = await tx
        .select({ id: accountingPeriods.id })
        .from(accountingPeriods)
        .innerJoin(fiscalYears, eq(fiscalYears.id, accountingPeriods.fiscalYearId))
        .where(and(eq(fiscalYears.code, "UJIFY2037"), eq(accountingPeriods.periodNo, 4)))
        .limit(1);
      if (!period) throw new Error("Periode April 2037 tidak ditemukan.");

      // sourceId UUID unik per peristiwa (unique index parsial source_active_uq)
      const SRC_BEBAN = "00000000-0000-4000-8000-000000002137";
      const SRC_PENDAPATAN = "00000000-0000-4000-8000-000000002237";
      const jeBeban = await createSystemDraft(tx, actorA, {
        entryDate: "2037-04-15",
        description: "Beban proyek uji",
        sourceType: "manual",
        sourceId: SRC_BEBAN,
        sourceEvent: "post",
        idempotencyKey: "project_uji_beban_2037",
        lines: [
          { accountId: accExpense, side: "debit", amount: "3500000", costCenterId: p1.costCenterId },
          { accountId: accBank, side: "credit", amount: "3500000" },
        ],
      });
      await postJournal(actorA, jeBeban.id, tx);

      const jePendapatan = await createSystemDraft(tx, actorA, {
        entryDate: "2037-04-20",
        description: "Pendapatan proyek uji",
        sourceType: "manual",
        sourceId: SRC_PENDAPATAN,
        sourceEvent: "post",
        idempotencyKey: "project_uji_pendapatan_2037",
        lines: [
          { accountId: accBank, side: "debit", amount: "5000000" },
          { accountId: accRevenue, side: "credit", amount: "5000000", costCenterId: p1.costCenterId },
        ],
      });
      const postedPendapatan = await postJournal(actorA, jePendapatan.id, tx);
      assert("jurnal pendapatan posted", postedPendapatan.status === "posted" && postedPendapatan.docNo !== null);

      /* ---------- Profitabilitas ---------- */
      const prof = await projectProfitability(actorA, { projectId: p1.id }, tx);
      const item = prof.items[0];
      assert("revenue UJP001 = 5.000.000", item?.revenue === "5000000.00");
      assert("cost UJP001 = 3.500.000", item?.cost === "3500000.00");
      assert("margin = 1.500.000", item?.margin === "1500000.00");
      assert("marginPct = 30.00", item?.marginPct === "30.00");
      assert("totals agregat cocok", prof.totals.margin === "1500000.00");
      const itemP2 = (await projectProfitability(actorA, { projectId: p2.id }, tx)).items[0];
      assert("proyek tanpa cc-jurnal profit nol", itemP2.revenue === "0.00" && itemP2.cost === "0.00" && itemP2.marginPct === null);

      /* ---------- Varian anggaran ---------- */
      const varAcc = item?.budgetVariances.find((v) => v.id === budgetAcc.id);
      assert("variance akun = actual-budget = -1.500.000", varAcc?.variance === "-1500000.00");
      assert("realisasi akun 70.00%", varAcc?.realizationPct === "70.00");
      const varAgg = item?.budgetVariances.find((v) => v.id !== budgetAcc.id);
      assert("variance agregat (8.000.000 vs 3.500.000) = -4.500.000", varAgg?.variance === "-4500000.00");

      /* ---------- Reversal menjaring netral ---------- */
      await reverseJournal(actorA, jeBeban.id, { reason: "Koreksi uji beban" }, tx);
      const profReversed = await projectProfitability(actorA, { projectId: p1.id }, tx);
      assert("setelah reversal cost kembali 0.00", profReversed.items[0]?.cost === "0.00");
      assert("margin setelah reversal = revenue penuh", profReversed.items[0]?.margin === "5000000.00");

      /* ---------- Guard status & kepemilikan ---------- */
      await updateProject(actorA, p1.id, { status: "completed" }, tx);
      await expectFail("tugas baru pada proyek completed", () =>
        createTask(actorA, p1.id, { name: "Tugas Selundup", sortOrder: 9, weightPercent: "1" }, tx),
      );
      await expectFail("milestone baru pada proyek completed", () =>
        createMilestone(actorA, p1.id, { name: "Milestone Selundup" }, tx),
      );
      await expectFail("hapus anggaran lewat id proyek lain", () =>
        removeAssignment(actorA, p2.id, assignment.id, tx),
      );
      await removeAssignment(actorA, p1.id, assignment.id, tx);
      assert("penugasan dilepas dari induk benar", true);

      /* ---------- Guard izin ---------- */
      const noGrants: AuthContext = { ...actorA, grants: [] };
      await expectFail("buat proyek tanpa izin", () =>
        createProject(noGrants, { code: "UJP009", name: "Proyek Tanpa Izin", startDate: "2037-04-01", status: "planning" }, tx),
      );
      await expectFail("baca profitabilitas tanpa izin", () => projectProfitability(noGrants, {}, tx));

      /* ---------- Filter daftar ---------- */
      const listCompleted = await listProjects(actorA, { status: "completed" }, tx);
      assert("filter status hanya mengembalikan UJP001", listCompleted.length === 1 && listCompleted[0].code === "UJP001");

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    console.log(`[test-project-flow] rollback OK — ${passed} asersi PASS, tidak ada data tersimpan di DB.`);
    return;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[test-project-flow] Gagal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
